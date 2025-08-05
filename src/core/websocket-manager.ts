import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '@/utils/logger';
import { MarketData, OrderBook, Trade } from '@/types';
import { Decimal } from 'decimal.js';

export interface WebSocketConfig {
  url: string;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}

export class WebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private reconnectAttempts = 0;
  private isConnecting = false;
  private isReconnecting = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private subscriptions = new Set<string>();
  private lastPing = 0;
  private lastPong = 0;

  constructor(config: WebSocketConfig) {
    super();
    this.config = {
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      pingInterval: 30000,
      pongTimeout: 10000,
      ...config,
    };
  }

  async connect(): Promise<void> {
    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    logger.info('Connecting to WebSocket', { url: this.config.url });

    try {
      this.ws = new WebSocket(this.config.url);
      this.setupEventHandlers();

      // Wait for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.ws!.once('open', () => {
          clearTimeout(timeout);
          resolve(void 0);
        });

        this.ws!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.startPinging();
      
      // Resubscribe to channels
      this.resubscribe();
      
      logger.info('WebSocket connected successfully');
      this.emit('connected');

    } catch (error) {
      this.isConnecting = false;
      logger.error('WebSocket connection failed', error);
      this.emit('error', error);
      
      if (!this.isReconnecting) {
        this.scheduleReconnect();
      }
      
      throw error;
    }
  }

  disconnect(): void {
    logger.info('Disconnecting WebSocket');
    
    this.isReconnecting = false;
    this.stopPinging();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.emit('disconnected');
  }

  subscribe(channel: string, symbol?: string): void {
    const subscription = symbol ? `${channel}:${symbol}` : channel;
    this.subscriptions.add(subscription);
    
    if (this.isConnected()) {
      this.sendSubscription(channel, symbol);
    }
  }

  unsubscribe(channel: string, symbol?: string): void {
    const subscription = symbol ? `${channel}:${symbol}` : channel;
    this.subscriptions.delete(subscription);
    
    if (this.isConnected()) {
      this.sendUnsubscription(channel, symbol);
    }
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      logger.debug('WebSocket opened');
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        logger.error('Failed to parse WebSocket message', { error, data: data.toString() });
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      logger.warn('WebSocket closed', { code, reason: reason.toString() });
      this.ws = null;
      this.stopPinging();
      this.scheduleReconnect();
    });

    this.ws.on('error', (error: Error) => {
      logger.error('WebSocket error', error);
      this.emit('error', error);
    });

    this.ws.on('pong', () => {
      this.lastPong = Date.now();
      logger.debug('Received pong', { 
        latency: this.lastPong - this.lastPing 
      });
    });
  }

  private handleMessage(message: any): void {
    try {
      if (message.channel === 'l2Book') {
        this.handleOrderBookUpdate(message);
      } else if (message.channel === 'trades') {
        this.handleTradeUpdate(message);
      } else if (message.channel === 'ticker') {
        this.handleTickerUpdate(message);
      } else if (message.type === 'pong') {
        // Handle pong response
        this.lastPong = Date.now();
      } else {
        logger.debug('Unhandled WebSocket message', message);
      }
    } catch (error) {
      logger.error('Error handling WebSocket message', { error, message });
    }
  }

  private handleOrderBookUpdate(message: any): void {
    try {
      const { data } = message;
      const symbol = data.coin;
      
      const bids = (data.levels?.[0] || []).map((level: any) => ({
        price: new Decimal(level.px),
        size: new Decimal(level.sz),
        orders: level.n || 1,
      }));

      const asks = (data.levels?.[1] || []).map((level: any) => ({
        price: new Decimal(level.px),
        size: new Decimal(level.sz),
        orders: level.n || 1,
      }));

      const orderBook: OrderBook = {
        symbol,
        timestamp: Date.now(),
        bids,
        asks,
        sequence: data.sequence || 0,
      };

      this.emit('orderBook', orderBook);
      
      // Also emit market data
      if (bids.length > 0 && asks.length > 0) {
        const marketData: MarketData = {
          symbol,
          timestamp: Date.now(),
          price: asks[0].price,
          bid: bids[0].price,
          ask: asks[0].price,
          bidSize: bids[0].size,
          askSize: asks[0].size,
          volume24h: new Decimal(data.volume24h || '0'),
          change24h: new Decimal(data.change24h || '0'),
          spread: asks[0].price.minus(bids[0].price),
          midPrice: asks[0].price.plus(bids[0].price).dividedBy(2),
        };
        
        this.emit('marketData', marketData);
      }
    } catch (error) {
      logger.error('Error processing order book update', error);
    }
  }

  private handleTradeUpdate(message: any): void {
    try {
      const { data } = message;
      
      const trades = data.map((tradeData: any) => ({
        id: tradeData.tid?.toString() || Date.now().toString(),
        symbol: tradeData.coin,
        timestamp: tradeData.time || Date.now(),
        price: new Decimal(tradeData.px),
        size: new Decimal(tradeData.sz),
        side: tradeData.side as 'buy' | 'sell',
        maker: !tradeData.startPosition,
      }));

      trades.forEach((trade: Trade) => {
        this.emit('trade', trade);
      });
    } catch (error) {
      logger.error('Error processing trade update', error);
    }
  }

  private handleTickerUpdate(message: any): void {
    try {
      const { data } = message;
      
      const marketData: MarketData = {
        symbol: data.coin,
        timestamp: Date.now(),
        price: new Decimal(data.price),
        bid: new Decimal(data.bid),
        ask: new Decimal(data.ask),
        bidSize: new Decimal(data.bidSize || '0'),
        askSize: new Decimal(data.askSize || '0'),
        volume24h: new Decimal(data.volume24h || '0'),
        change24h: new Decimal(data.change24h || '0'),
        spread: new Decimal(data.ask).minus(new Decimal(data.bid)),
        midPrice: new Decimal(data.ask).plus(new Decimal(data.bid)).dividedBy(2),
      };

      this.emit('marketData', marketData);
    } catch (error) {
      logger.error('Error processing ticker update', error);
    }
  }

  private sendSubscription(channel: string, symbol?: string): void {
    const message = {
      method: 'subscribe',
      subscription: {
        type: channel,
        coin: symbol,
      },
    };

    this.send(message);
    logger.debug('Sent subscription', { channel, symbol });
  }

  private sendUnsubscription(channel: string, symbol?: string): void {
    const message = {
      method: 'unsubscribe',
      subscription: {
        type: channel,
        coin: symbol,
      },
    };

    this.send(message);
    logger.debug('Sent unsubscription', { channel, symbol });
  }

  private send(message: any): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(message));
    } else {
      logger.warn('Cannot send message - WebSocket not connected', message);
    }
  }

  private resubscribe(): void {
    this.subscriptions.forEach(subscription => {
      const [channel, symbol] = subscription.split(':');
      this.sendSubscription(channel, symbol);
    });
  }

  private startPinging(): void {
    this.stopPinging();
    
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        this.lastPing = Date.now();
        this.ws!.ping();
        
        // Set timeout for pong response
        this.pongTimeout = setTimeout(() => {
          logger.warn('Pong timeout - reconnecting');
          this.disconnect();
          this.scheduleReconnect();
        }, this.config.pongTimeout);
      }
    }, this.config.pingInterval);
  }

  private stopPinging(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isReconnecting || this.reconnectAttempts >= this.config.maxReconnectAttempts!) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = this.config.reconnectDelay! * Math.pow(2, Math.min(this.reconnectAttempts - 1, 5));
    
    logger.info('Scheduling reconnect', { 
      attempt: this.reconnectAttempts, 
      delay,
      maxAttempts: this.config.maxReconnectAttempts 
    });

    setTimeout(async () => {
      this.isReconnecting = false;
      try {
        await this.connect();
      } catch (error) {
        logger.error('Reconnection failed', error);
      }
    }, delay);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getConnectionStatus(): {
    connected: boolean;
    reconnectAttempts: number;
    lastPing: number;
    lastPong: number;
    latency: number;
  } {
    return {
      connected: this.isConnected(),
      reconnectAttempts: this.reconnectAttempts,
      lastPing: this.lastPing,
      lastPong: this.lastPong,
      latency: this.lastPong - this.lastPing,
    };
  }
}
