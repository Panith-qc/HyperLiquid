import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { Decimal } from 'decimal.js';
import { logger } from '@/utils/logger';
import { RateLimiter } from './rate-limiter';
import { AuthManager } from './auth';
import { ErrorHandler } from './error-handler';
import { 
  MarketData, 
  OrderBook, 
  Trade, 
  Order, 
  Position, 
  OrderType, 
  OrderSide 
} from '@/types';

export interface HyperliquidConfig {
  apiUrl: string;
  wsUrl: string;
  apiKey: string;
  secret: string;
  walletAddress: string;
  privateKey: string;
  testnet: boolean;
}

export class HyperliquidClient {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private auth: AuthManager;
  private errorHandler: ErrorHandler;
  private config: HyperliquidConfig;

  constructor(config: HyperliquidConfig) {
    this.config = config;
    this.auth = new AuthManager(config);
    this.rateLimiter = new RateLimiter();
    this.errorHandler = new ErrorHandler();
    
    this.client = axios.create({
      baseURL: config.apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HyperliquidBot/1.0',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      async (config) => {
        // Rate limiting
        await this.rateLimiter.checkLimit();
        
        // Add authentication
        const authHeaders = this.auth.getAuthHeaders(config);
        config.headers = { ...config.headers, ...authHeaders };
        
        logger.debug('API Request', {
          method: config.method,
          url: config.url,
          data: config.data
        });
        
        return config;
      },
      (error) => {
        logger.error('Request interceptor error', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        logger.debug('API Response', {
          status: response.status,
          url: response.config.url,
          data: response.data
        });
        return response;
      },
      (error) => {
        return this.errorHandler.handleApiError(error);
      }
    );
  }

  /**
   * Test API connectivity
   */
  async testConnectivity(): Promise<boolean> {
    try {
      const response = await this.client.get('/info', {
        params: { type: 'meta' }
      });
      return response.status === 200;
    } catch (error) {
      logger.error('Connectivity test failed', error);
      return false;
    }
  }

  /**
   * Get market information
   */
  async getMarketInfo(): Promise<any> {
    const response = await this.client.get('/info', {
      params: { type: 'meta' }
    });
    return response.data;
  }

  /**
   * Get current market data for a symbol
   */
  async getMarketData(symbol: string): Promise<MarketData> {
    const response = await this.client.get('/info', {
      params: { type: 'l2Book', coin: symbol }
    });

    const data = response.data;
    const bid = data.levels?.[0]?.[0] || '0';
    const ask = data.levels?.[1]?.[0] || '0';
    const bidSize = data.levels?.[0]?.[1] || '0';
    const askSize = data.levels?.[1]?.[1] || '0';

    return {
      symbol,
      timestamp: Date.now(),
      price: new Decimal(ask),
      bid: new Decimal(bid),
      ask: new Decimal(ask),
      bidSize: new Decimal(bidSize),
      askSize: new Decimal(askSize),
      volume24h: new Decimal(data.volume24h || '0'),
      change24h: new Decimal(data.change24h || '0'),
      spread: new Decimal(ask).minus(new Decimal(bid)),
      midPrice: new Decimal(ask).plus(new Decimal(bid)).dividedBy(2),
    };
  }

  /**
   * Get order book for a symbol
   */
  async getOrderBook(symbol: string, depth: number = 20): Promise<OrderBook> {
    const response = await this.client.get('/info', {
      params: { type: 'l2Book', coin: symbol }
    });

    const data = response.data;
    const bids = (data.levels?.[0] || []).slice(0, depth).map((level: any) => ({
      price: new Decimal(level.px),
      size: new Decimal(level.sz),
      orders: level.n || 1,
    }));

    const asks = (data.levels?.[1] || []).slice(0, depth).map((level: any) => ({
      price: new Decimal(level.px),
      size: new Decimal(level.sz),
      orders: level.n || 1,
    }));

    return {
      symbol,
      timestamp: Date.now(),
      bids,
      asks,
      sequence: data.sequence || 0,
    };
  }

  /**
   * Get recent trades for a symbol
   */
  async getRecentTrades(symbol: string, limit: number = 100): Promise<Trade[]> {
    const response = await this.client.get('/info', {
      params: { type: 'recentTrades', coin: symbol }
    });

    return response.data.map((trade: any) => ({
      id: trade.tid.toString(),
      symbol,
      timestamp: trade.time,
      price: new Decimal(trade.px),
      size: new Decimal(trade.sz),
      side: trade.side as 'buy' | 'sell',
      maker: !trade.startPosition,
    }));
  }

  /**
   * Get account positions
   */
  async getPositions(): Promise<Position[]> {
    const response = await this.client.post('/info', {
      type: 'clearinghouseState',
      user: this.config.walletAddress,
    });

    const positions = response.data.assetPositions || [];
    return positions.map((pos: any) => ({
      symbol: pos.position.coin,
      side: pos.position.szi > 0 ? OrderSide.BUY : OrderSide.SELL,
      size: new Decimal(Math.abs(pos.position.szi)),
      entryPrice: new Decimal(pos.position.entryPx || '0'),
      markPrice: new Decimal(pos.position.positionValue || '0'),
      unrealizedPnl: new Decimal(pos.position.unrealizedPnl || '0'),
      realizedPnl: new Decimal(pos.position.realizedPnl || '0'),
      timestamp: Date.now(),
      fees: new Decimal(pos.position.cumFunding?.allTime || '0'),
      rebates: new Decimal('0'), // Calculate separately
    }));
  }

  /**
   * Get open orders
   */
  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const response = await this.client.post('/info', {
      type: 'openOrders',
      user: this.config.walletAddress,
    });

    let orders = response.data || [];
    if (symbol) {
      orders = orders.filter((order: any) => order.coin === symbol);
    }

    return orders.map((order: any) => ({
      id: order.oid.toString(),
      clientOrderId: order.cloid || '',
      symbol: order.coin,
      type: this.mapOrderType(order.orderType),
      side: order.side as OrderSide,
      amount: new Decimal(order.sz),
      price: new Decimal(order.limitPx),
      stopPrice: order.triggerPx ? new Decimal(order.triggerPx) : undefined,
      status: this.mapOrderStatus(order.orderType),
      filled: new Decimal(order.sz).minus(new Decimal(order.remainingSize || order.sz)),
      remaining: new Decimal(order.remainingSize || order.sz),
      timestamp: order.timestamp,
      updatedAt: Date.now(),
      fees: new Decimal('0'),
      rebates: new Decimal('0'),
      maker: true, // Assume maker orders for one-sided quoting
    }));
  }

  /**
   * Place a new order
   */
  async placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    amount: Decimal;
    price?: Decimal;
    stopPrice?: Decimal;
    timeInForce?: string;
    clientOrderId?: string;
  }): Promise<Order> {
    const orderRequest = {
      coin: params.symbol,
      is_buy: params.side === OrderSide.BUY,
      sz: params.amount.toNumber(),
      limit_px: params.price?.toNumber(),
      order_type: this.mapOrderTypeToApi(params.type),
      reduce_only: false,
      cloid: params.clientOrderId,
    };

    // Sign the order
    const signature = this.auth.signOrder(orderRequest);
    
    const response = await this.client.post('/exchange', {
      action: {
        type: 'order',
        orders: [orderRequest],
        grouping: 'na',
      },
      nonce: Date.now(),
      signature,
    });

    if (response.data.status === 'ok') {
      // Return the placed order
      return this.mapApiOrderToOrder(response.data.response.data.statuses[0], params);
    } else {
      throw new Error(`Order placement failed: ${response.data.response}`);
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const cancelRequest = {
      coin: symbol,
      o: parseInt(orderId),
    };

    const signature = this.auth.signCancel(cancelRequest);
    
    const response = await this.client.post('/exchange', {
      action: {
        type: 'cancel',
        cancels: [cancelRequest],
      },
      nonce: Date.now(),
      signature,
    });

    return response.data.status === 'ok';
  }

  /**
   * Cancel all orders for a symbol
   */
  async cancelAllOrders(symbol: string): Promise<boolean> {
    const response = await this.client.post('/exchange', {
      action: {
        type: 'cancelByCloid',
        cancels: [{
          coin: symbol,
          cloid: 'all',
        }],
      },
      nonce: Date.now(),
      signature: this.auth.signCancelAll(symbol),
    });

    return response.data.status === 'ok';
  }

  /**
   * Get trading fees
   */
  async getTradingFees(): Promise<{ maker: Decimal; taker: Decimal }> {
    // Hyperliquid typically has 0.0030% maker rebate and 0.05% taker fee
    return {
      maker: new Decimal(-0.00003), // Negative indicates rebate
      taker: new Decimal(0.0005),
    };
  }

  // Helper methods
  private mapOrderType(apiType: string): OrderType {
    switch (apiType) {
      case 'Limit': return OrderType.LIMIT;
      case 'Market': return OrderType.MARKET;
      case 'Stop': return OrderType.STOP;
      case 'StopLimit': return OrderType.STOP_LIMIT;
      default: return OrderType.LIMIT;
    }
  }

  private mapOrderTypeToApi(type: OrderType): any {
    switch (type) {
      case OrderType.LIMIT: return { limit: { tif: 'Gtc' } };
      case OrderType.MARKET: return { market: {} };
      case OrderType.STOP: return { stop: {} };
      case OrderType.STOP_LIMIT: return { stopLimit: {} };
    }
  }

  private mapOrderStatus(apiStatus: string): any {
    // Map API status to internal status
    return 'open'; // Simplified for now
  }

  private mapApiOrderToOrder(apiOrder: any, params: any): Order {
    return {
      id: apiOrder.oid?.toString() || '',
      clientOrderId: params.clientOrderId || '',
      symbol: params.symbol,
      type: params.type,
      side: params.side,
      amount: params.amount,
      price: params.price,
      stopPrice: params.stopPrice,
      status: 'open' as any,
      filled: new Decimal(0),
      remaining: params.amount,
      timestamp: Date.now(),
      updatedAt: Date.now(),
      fees: new Decimal(0),
      rebates: new Decimal(0),
      maker: true,
    };
  }
}