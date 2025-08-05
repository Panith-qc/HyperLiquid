import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { logger, tradingLogger } from '@/utils/logger';
import { MathUtils } from '@/utils/math';
import { 
  MarketData, 
  OrderBook, 
  Signal, 
  Order, 
  Position, 
  Direction, 
  OrderSide, 
  OrderType,
  TradingDecision 
} from '@/types';
import { HyperliquidClient } from '@/api/hyperliquid-api';
import { RiskManager } from '@/core/risk-manager';
import { SignalGenerator } from './signal-generator';

export interface OneSidedQuotingConfig {
  symbols: string[];
  maxPositionSize: Decimal;
  baseOrderSize: Decimal;
  confidenceThreshold: Decimal;
  targetFillRate: Decimal;
  aggressivenessFactor: Decimal;
  quoteUpdateFrequency: number;
  maxSpreadPercent: Decimal;
  minSpreadTicks: number;
  positionTimeoutMs: number;
  rebateThreshold: Decimal;
}

export class OneSidedQuotingStrategy extends EventEmitter {
  private config: OneSidedQuotingConfig;
  private client: HyperliquidClient;
  private riskManager: RiskManager;
  private signalGenerator: SignalGenerator;
  
  private marketData: Map<string, MarketData> = new Map();
  private orderBooks: Map<string, OrderBook> = new Map();
  private activeOrders: Map<string, Order[]> = new Map();
  private positions: Map<string, Position> = new Map();
  private lastQuoteTime: Map<string, number> = new Map();
  private fillHistory: Map<string, Array<{ timestamp: number; rebate: Decimal }>> = new Map();
  
  private isRunning = false;
  private quoteInterval: NodeJS.Timeout | null = null;

  constructor(
    config: OneSidedQuotingConfig,
    client: HyperliquidClient,
    riskManager: RiskManager,
    signalGenerator: SignalGenerator
  ) {
    super();
    this.config = config;
    this.client = client;
    this.riskManager = riskManager;
    this.signalGenerator = signalGenerator;

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.signalGenerator.on('signal', (signal: Signal) => {
      this.processSignal(signal);
    });

    this.riskManager.on('riskAlert', (alert: any) => {
      this.handleRiskAlert(alert);
    });
  }

  /**
   * Start the one-sided quoting strategy
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('OneSidedQuotingStrategy already running');
      return;
    }

    logger.info('Starting OneSidedQuotingStrategy', {
      symbols: this.config.symbols,
      maxPositionSize: this.config.maxPositionSize.toNumber(),
      confidenceThreshold: this.config.confidenceThreshold.toNumber(),
    });

    try {
      // Load initial positions
      await this.loadPositions();
      
      // Start quote updating
      this.startQuoteUpdating();
      
      this.isRunning = true;
      this.emit('started');
      
      tradingLogger.info('OneSidedQuotingStrategy started successfully');
    } catch (error) {
      logger.error('Failed to start OneSidedQuotingStrategy', error);
      throw error;
    }
  }

  /**
   * Stop the strategy
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping OneSidedQuotingStrategy');

    this.isRunning = false;
    
    if (this.quoteInterval) {
      clearInterval(this.quoteInterval);
      this.quoteInterval = null;
    }

    // Cancel all active orders
    await this.cancelAllOrders();
    
    this.emit('stopped');
    tradingLogger.info('OneSidedQuotingStrategy stopped');
  }

  /**
   * Process new market data
   */
  processMarketData(marketData: MarketData): void {
    this.marketData.set(marketData.symbol, marketData);
    
    // Update quotes if enough time has passed
    const lastQuoteTime = this.lastQuoteTime.get(marketData.symbol) || 0;
    const now = Date.now();
    
    if (now - lastQuoteTime >= this.config.quoteUpdateFrequency) {
      this.updateQuotes(marketData.symbol);
    }
  }

  /**
   * Process order book updates
   */
  processOrderBook(orderBook: OrderBook): void {
    this.orderBooks.set(orderBook.symbol, orderBook);
  }

  /**
   * Process trading signals
   */
  private async processSignal(signal: Signal): Promise<void> {
    if (!this.isRunning || !this.config.symbols.includes(signal.symbol)) {
      return;
    }

    if (signal.confidence.lessThan(this.config.confidenceThreshold)) {
      logger.debug('Signal confidence too low', {
        symbol: signal.symbol,
        confidence: signal.confidence.toNumber(),
        threshold: this.config.confidenceThreshold.toNumber(),
      });
      return;
    }

    await this.updateQuotes(signal.symbol);
  }

  /**
   * Update quotes for a symbol based on current signal and market conditions
   */
  private async updateQuotes(symbol: string): Promise<void> {
    try {
      const signal = this.signalGenerator.getLatestSignal(symbol);
      const marketData = this.marketData.get(symbol);
      const orderBook = this.orderBooks.get(symbol);

      if (!signal || !marketData || !orderBook) {
        logger.debug('Insufficient data for quote update', {
          symbol,
          hasSignal: !!signal,
          hasMarketData: !!marketData,
          hasOrderBook: !!orderBook,
        });
        return;
      }

      // Check risk limits
      if (!this.riskManager.canTrade(symbol)) {
        logger.debug('Risk manager prevents trading', { symbol });
        return;
      }

      // Cancel existing orders first (one-sided quoting)
      await this.cancelSymbolOrders(symbol);

      // Generate trading decision
      const decision = this.generateTradingDecision(signal, marketData, orderBook);
      
      if (decision.action !== 'HOLD') {
        await this.placeQuote(decision);
        this.lastQuoteTime.set(symbol, Date.now());
      }

      tradingLogger.debug('Quote update completed', {
        symbol,
        action: decision.action,
        direction: signal.direction,
        confidence: signal.confidence.toNumber(),
        price: decision.price.toNumber(),
        size: decision.size.toNumber(),
      });

    } catch (error) {
      logger.error('Error updating quotes', { error, symbol });
    }
  }

  /**
   * Generate trading decision based on signal and market data
   */
  private generateTradingDecision(
    signal: Signal,
    marketData: MarketData,
    orderBook: OrderBook
  ): TradingDecision {
    const symbol = signal.symbol;
    
    // Determine action based on signal direction
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let side: OrderSide;
    let referencePrice: Decimal;

    if (signal.direction === Direction.LONG) {
      action = 'BUY';
      side = OrderSide.BUY;
      referencePrice = orderBook.bids.length > 0 ? orderBook.bids[0].price : marketData.bid;
    } else if (signal.direction === Direction.SHORT) {
      action = 'SELL';
      side = OrderSide.SELL;
      referencePrice = orderBook.asks.length > 0 ? orderBook.asks[0].price : marketData.ask;
    } else {
      return {
        signal,
        action: 'HOLD',
        size: new Decimal(0),
        price: new Decimal(0),
        orderType: OrderType.LIMIT,
        reasoning: 'Neutral signal - no action',
        riskLevel: 'LOW',
      };
    }

    // Calculate optimal quote price
    const quotePrice = this.calculateQuotePrice(
      signal,
      marketData,
      orderBook,
      side,
      referencePrice
    );

    // Calculate position size
    const quoteSize = this.calculateQuoteSize(signal, symbol);

    // Validate the decision
    if (!this.validateTradingDecision(symbol, side, quoteSize, quotePrice)) {
      return {
        signal,
        action: 'HOLD',
        size: new Decimal(0),
        price: new Decimal(0),
        orderType: OrderType.LIMIT,
        reasoning: 'Failed validation checks',
        riskLevel: 'HIGH',
      };
    }

    const riskLevel = this.assessRiskLevel(signal, quoteSize, quotePrice);

    return {
      signal,
      action,
      size: quoteSize,
      price: quotePrice,
      orderType: OrderType.LIMIT,
      reasoning: `${signal.direction} signal (${signal.confidence.toFixed(2)} confidence) - ${signal.reason}`,
      riskLevel,
    };
  }

  /**
   * Calculate optimal quote price for maximum rebate capture
   */
  private calculateQuotePrice(
    signal: Signal,
    marketData: MarketData,
    orderBook: OrderBook,
    side: OrderSide,
    referencePrice: Decimal
  ): Decimal {
    const spread = marketData.ask.minus(marketData.bid);
    const midPrice = marketData.midPrice;
    
    // Base aggressiveness on signal confidence
    const baseAggressiveness = this.config.aggressivenessFactor;
    const signalAggressiveness = signal.confidence.multipliedBy(0.5); // Max 50% additional
    const totalAggressiveness = baseAggressiveness.plus(signalAggressiveness).clampedTo(0, 1);

    let quotePrice: Decimal;

    if (side === OrderSide.BUY) {
      // For buy orders, quote below the best bid to ensure maker status
      const bestBid = orderBook.bids.length > 0 ? orderBook.bids[0].price : marketData.bid;
      const aggressiveOffset = spread.multipliedBy(totalAggressiveness).multipliedBy(0.5);
      quotePrice = bestBid.minus(aggressiveOffset);
      
      // Ensure we don't cross the spread
      quotePrice = Decimal.min(quotePrice, midPrice.minus(spread.multipliedBy(0.1)));
    } else {
      // For sell orders, quote above the best ask to ensure maker status
      const bestAsk = orderBook.asks.length > 0 ? orderBook.asks[0].price : marketData.ask;
      const aggressiveOffset = spread.multipliedBy(totalAggressiveness).multipliedBy(0.5);
      quotePrice = bestAsk.plus(aggressiveOffset);
      
      // Ensure we don't cross the spread
      quotePrice = Decimal.max(quotePrice, midPrice.plus(spread.multipliedBy(0.1)));
    }

    // Apply minimum tick size rounding
    const tickSize = this.getTickSize(signal.symbol);
    quotePrice = MathUtils.roundToTickSize(quotePrice, tickSize);

    return quotePrice;
  }

  /**
   * Calculate quote size based on signal strength and risk management
   */
  private calculateQuoteSize(signal: Signal, symbol: string): Decimal {
    const baseSize = this.config.baseOrderSize;
    const maxSize = this.config.maxPositionSize;
    
    // Scale size based on signal confidence and strength
    const confidenceMultiplier = signal.confidence.clampedTo(0.5, 1); // Min 50% of base size
    const strengthMultiplier = signal.strength.plus(new Decimal(0.5)).clampedTo(0.5, 1.5);
    
    let size = baseSize
      .multipliedBy(confidenceMultiplier)
      .multipliedBy(strengthMultiplier);

    // Apply position limits
    const currentPosition = this.positions.get(symbol);
    if (currentPosition) {
      const availableSize = maxSize.minus(currentPosition.size.abs());
      size = Decimal.min(size, availableSize);
    }

    // Apply risk manager limits
    const riskAdjustedSize = this.riskManager.getMaxPositionSize(symbol, size);
    size = Decimal.min(size, riskAdjustedSize);

    return size.clampedTo(new Decimal(0), maxSize);
  }

  /**
   * Place a quote order
   */
  private async placeQuote(decision: TradingDecision): Promise<void> {
    try {
      const order = await this.client.placeOrder({
        symbol: decision.signal.symbol,
        side: decision.action === 'BUY' ? OrderSide.BUY : OrderSide.SELL,
        type: OrderType.LIMIT,
        amount: decision.size,
        price: decision.price,
        clientOrderId: `quote_${Date.now()}`,
      });

      // Track the order
      const symbolOrders = this.activeOrders.get(decision.signal.symbol) || [];
      symbolOrders.push(order);
      this.activeOrders.set(decision.signal.symbol, symbolOrders);

      // Update risk manager
      this.riskManager.addPendingOrder(order);

      tradingLogger.info('Quote placed', {
        symbol: decision.signal.symbol,
        side: decision.action,
        size: decision.size.toNumber(),
        price: decision.price.toNumber(),
        orderId: order.id,
        reasoning: decision.reasoning,
      });

      this.emit('orderPlaced', order);

    } catch (error) {
      logger.error('Failed to place quote', {
        error,
        symbol: decision.signal.symbol,
        decision,
      });
    }
  }

  /**
   * Validate trading decision against various checks
   */
  private validateTradingDecision(
    symbol: string,
    side: OrderSide,
    size: Decimal,
    price: Decimal
  ): boolean {
    // Check minimum size
    if (size.lessThan(1)) {
      logger.debug('Size too small', { symbol, size: size.toNumber() });
      return false;
    }

    // Check price validity
    if (price.lessThanOrEqualTo(0)) {
      logger.debug('Invalid price', { symbol, price: price.toNumber() });
      return false;
    }

    // Check spread constraints
    const marketData = this.marketData.get(symbol);
    if (marketData) {
      const spread = marketData.ask.minus(marketData.bid);
      const maxSpread = marketData.midPrice.multipliedBy(this.config.maxSpreadPercent.dividedBy(100));
      
      if (spread.greaterThan(maxSpread)) {
        logger.debug('Spread too wide', { 
          symbol, 
          spread: spread.toNumber(), 
          maxSpread: maxSpread.toNumber() 
        });
        return false;
      }
    }

    // Check risk manager approval
    if (!this.riskManager.canTrade(symbol)) {
      logger.debug('Risk manager prevents trade', { symbol });
      return false;
    }

    return true;
  }

  /**
   * Assess risk level of a trading decision
   */
  private assessRiskLevel(signal: Signal, size: Decimal, price: Decimal): 'LOW' | 'MEDIUM' | 'HIGH' {
    let risk = 0;

    // Signal confidence risk
    if (signal.confidence.lessThan(0.7)) risk += 1;
    if (signal.confidence.lessThan(0.5)) risk += 1;

    // Size risk
    const sizeRatio = size.dividedBy(this.config.maxPositionSize);
    if (sizeRatio.greaterThan(0.5)) risk += 1;
    if (sizeRatio.greaterThan(0.8)) risk += 1;

    // Market condition risk
    const marketData = this.marketData.get(signal.symbol);
    if (marketData) {
      const spreadPercent = marketData.spread.dividedBy(marketData.midPrice).multipliedBy(100);
      if (spreadPercent.greaterThan(0.5)) risk += 1;
      if (spreadPercent.greaterThan(1.0)) risk += 1;
    }

    if (risk <= 1) return 'LOW';
    if (risk <= 3) return 'MEDIUM';
    return 'HIGH';
  }

  /**
   * Handle risk alerts from risk manager
   */
  private async handleRiskAlert(alert: any): Promise<void> {
    logger.warn('Risk alert received', alert);

    if (alert.level === 'EMERGENCY') {
      logger.error('Emergency stop triggered - canceling all orders');
      await this.cancelAllOrders();
      await this.stop();
      this.emit('emergencyStop', alert);
    } else if (alert.level === 'CRITICAL') {
      logger.warn('Critical risk alert - reducing positions');
      // Could implement position reduction logic here
    }
  }

  /**
   * Start periodic quote updating
   */
  private startQuoteUpdating(): void {
    this.quoteInterval = setInterval(async () => {
      if (!this.isRunning) return;

      for (const symbol of this.config.symbols) {
        try {
          await this.updateQuotes(symbol);
        } catch (error) {
          logger.error('Error in periodic quote update', { error, symbol });
        }
      }
    }, this.config.quoteUpdateFrequency);
  }

  /**
   * Cancel all orders for a specific symbol
   */
  private async cancelSymbolOrders(symbol: string): Promise<void> {
    const orders = this.activeOrders.get(symbol) || [];
    
    for (const order of orders) {
      try {
        await this.client.cancelOrder(order.id, symbol);
        this.riskManager.removePendingOrder(order.id);
      } catch (error) {
        logger.error('Failed to cancel order', { error, orderId: order.id });
      }
    }
    
    this.activeOrders.set(symbol, []);
  }

  /**
   * Cancel all orders across all symbols
   */
  private async cancelAllOrders(): Promise<void> {
    for (const symbol of this.config.symbols) {
      await this.cancelSymbolOrders(symbol);
    }
  }

  /**
   * Load current positions from exchange
   */
  private async loadPositions(): Promise<void> {
    try {
      const positions = await this.client.getPositions();
      
      positions.forEach(position => {
        this.positions.set(position.symbol, position);
        this.riskManager.updatePosition(position);
      });

      logger.info('Loaded positions', { count: positions.length });
    } catch (error) {
      logger.error('Failed to load positions', error);
    }
  }

  /**
   * Get tick size for a symbol
   */
  private getTickSize(symbol: string): Decimal {
    // This should be fetched from exchange info
    // For now, using default values
    const tickSizes: Record<string, Decimal> = {
      'ETH': new Decimal('0.01'),
      'BTC': new Decimal('0.01'),
      'SOL': new Decimal('0.001'),
    };
    
    return tickSizes[symbol] || new Decimal('0.01');
  }

  /**
   * Get strategy statistics
   */
  getStatistics(): {
    isRunning: boolean;
    activeOrders: number;
    positions: number;
    totalRebates: Decimal;
    fillRate: Decimal;
    avgFillTime: number;
  } {
    let totalActiveOrders = 0;
    this.activeOrders.forEach(orders => {
      totalActiveOrders += orders.length;
    });

    let totalRebates = new Decimal(0);
    let totalFills = 0;
    this.fillHistory.forEach(fills => {
      totalFills += fills.length;
      fills.forEach(fill => {
        totalRebates = totalRebates.plus(fill.rebate);
      });
    });

    // Calculate fill rate (simplified)
    const fillRate = new Decimal(0.65); // Placeholder - would calculate from actual data

    return {
      isRunning: this.isRunning,
      activeOrders: totalActiveOrders,
      positions: this.positions.size,
      totalRebates,
      fillRate,
      avgFillTime: 0, // Placeholder
    };
  }
}