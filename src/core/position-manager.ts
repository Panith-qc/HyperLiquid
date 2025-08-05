import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { logger, tradingLogger } from '@/utils/logger';
import { Position, Order, OrderSide, MarketData } from '@/types';
import { HyperliquidClient } from '@/api/hyperliquid-api';
import { MathUtils } from '@/utils/math';

export interface PositionManagerConfig {
  maxHoldTime: number;
  profitTarget: Decimal;
  stopLoss: Decimal;
  trailingStopDistance: Decimal;
  positionSizeIncrement: Decimal;
  maxPositionLayers: number;
}

export class PositionManager extends EventEmitter {
  private config: PositionManagerConfig;
  private client: HyperliquidClient;
  private positions: Map<string, Position> = new Map();
  private positionMetrics: Map<string, PositionMetrics> = new Map();
  private marketData: Map<string, MarketData> = new Map();

  constructor(config: PositionManagerConfig, client: HyperliquidClient) {
    super();
    this.config = config;
    this.client = client;
  }

  /**
   * Add or update a position
   */
  updatePosition(position: Position): void {
    const existing = this.positions.get(position.symbol);
    this.positions.set(position.symbol, position);

    // Initialize or update position metrics
    if (!existing) {
      this.initializePositionMetrics(position);
    } else {
      this.updatePositionMetrics(position);
    }

    // Check position management rules
    this.checkPositionRules(position);

    this.emit('positionUpdated', position);
  }

  /**
   * Process market data update for position management
   */
  updateMarketData(marketData: MarketData): void {
    this.marketData.set(marketData.symbol, marketData);
    
    const position = this.positions.get(marketData.symbol);
    if (position) {
      // Update mark price
      position.markPrice = marketData.price;
      
      // Recalculate unrealized PnL
      position.unrealizedPnl = this.calculateUnrealizedPnl(position, marketData.price);
      
      // Update position metrics
      this.updatePositionMetrics(position);
      
      // Check exit conditions
      this.checkExitConditions(position, marketData);
    }
  }

  /**
   * Calculate unrealized PnL
   */
  private calculateUnrealizedPnl(position: Position, currentPrice: Decimal): Decimal {
    const priceDiff = position.side === OrderSide.BUY
      ? currentPrice.minus(position.entryPrice)
      : position.entryPrice.minus(currentPrice);
    
    return priceDiff.multipliedBy(position.size);
  }

  /**
   * Initialize position metrics
   */
  private initializePositionMetrics(position: Position): void {
    const metrics: PositionMetrics = {
      symbol: position.symbol,
      entryTime: position.timestamp,
      entryPrice: position.entryPrice,
      maxFavorableExcursion: new Decimal(0),
      maxAdverseExcursion: new Decimal(0),
      highWaterMark: position.entryPrice,
      lowWaterMark: position.entryPrice,
      layerCount: 1,
      avgEntryPrice: position.entryPrice,
      totalSize: position.size,
    };

    this.positionMetrics.set(position.symbol, metrics);
  }

  /**
   * Update position metrics
   */
  private updatePositionMetrics(position: Position): void {
    const metrics = this.positionMetrics.get(position.symbol);
    if (!metrics) return;

    const currentPrice = position.markPrice;
    
    // Update high/low water marks
    if (currentPrice.greaterThan(metrics.highWaterMark)) {
      metrics.highWaterMark = currentPrice;
    }
    if (currentPrice.lessThan(metrics.lowWaterMark)) {
      metrics.lowWaterMark = currentPrice;
    }

    // Calculate excursions
    if (position.side === OrderSide.BUY) {
      metrics.maxFavorableExcursion = Decimal.max(
        metrics.maxFavorableExcursion,
        metrics.highWaterMark.minus(metrics.entryPrice)
      );
      metrics.maxAdverseExcursion = Decimal.max(
        metrics.maxAdverseExcursion,
        metrics.entryPrice.minus(metrics.lowWaterMark)
      );
    } else {
      metrics.maxFavorableExcursion = Decimal.max(
        metrics.maxFavorableExcursion,
        metrics.entryPrice.minus(metrics.lowWaterMark)
      );
      metrics.maxAdverseExcursion = Decimal.max(
        metrics.maxAdverseExcursion,
        metrics.highWaterMark.minus(metrics.entryPrice)
      );
    }
  }

  /**
   * Check position management rules
   */
  private checkPositionRules(position: Position): void {
    const metrics = this.positionMetrics.get(position.symbol);
    if (!metrics) return;

    const holdTime = Date.now() - metrics.entryTime;
    const holdTimeMinutes = holdTime / (1000 * 60);

    // Check maximum hold time
    if (holdTimeMinutes > this.config.maxHoldTime) {
      this.emit('positionTimeout', {
        position,
        holdTime: holdTimeMinutes,
        reason: 'Maximum hold time exceeded',
      });
    }

    // Check position size limits
    const positionValue = position.size.multipliedBy(position.markPrice);
    if (positionValue.greaterThan(this.config.positionSizeIncrement.multipliedBy(this.config.maxPositionLayers))) {
      this.emit('positionSizeWarning', {
        position,
        value: positionValue,
        reason: 'Position size exceeds maximum layers',
      });
    }
  }

  /**
   * Check exit conditions for a position
   */
  private checkExitConditions(position: Position, marketData: MarketData): void {
    const metrics = this.positionMetrics.get(position.symbol);
    if (!metrics) return;

    const currentPrice = marketData.price;
    const unrealizedPnl = position.unrealizedPnl;
    const unrealizedPnlPercent = position.entryPrice.isZero() 
      ? new Decimal(0)
      : unrealizedPnl.dividedBy(position.entryPrice.multipliedBy(position.size)).multipliedBy(100);

    // Profit target check
    if (unrealizedPnlPercent.greaterThanOrEqualTo(this.config.profitTarget)) {
      this.emit('profitTargetHit', {
        position,
        unrealizedPnl,
        unrealizedPnlPercent,
        reason: 'Profit target reached',
      });
    }

    // Stop loss check
    if (unrealizedPnlPercent.lessThanOrEqualTo(this.config.stopLoss.negated())) {
      this.emit('stopLossHit', {
        position,
        unrealizedPnl,
        unrealizedPnlPercent,
        reason: 'Stop loss triggered',
      });
    }

    // Trailing stop check
    this.checkTrailingStop(position, currentPrice, metrics);
  }

  /**
   * Check trailing stop condition
   */
  private checkTrailingStop(position: Position, currentPrice: Decimal, metrics: PositionMetrics): void {
    const trailingDistance = this.config.trailingStopDistance;
    
    if (position.side === OrderSide.BUY) {
      const trailingStopPrice = metrics.highWaterMark.minus(
        metrics.highWaterMark.multipliedBy(trailingDistance.dividedBy(100))
      );
      
      if (currentPrice.lessThanOrEqualTo(trailingStopPrice)) {
        this.emit('trailingStopHit', {
          position,
          currentPrice,
          stopPrice: trailingStopPrice,
          highWaterMark: metrics.highWaterMark,
          reason: 'Trailing stop triggered (LONG)',
        });
      }
    } else {
      const trailingStopPrice = metrics.lowWaterMark.plus(
        metrics.lowWaterMark.multipliedBy(trailingDistance.dividedBy(100))
      );
      
      if (currentPrice.greaterThanOrEqualTo(trailingStopPrice)) {
        this.emit('trailingStopHit', {
          position,
          currentPrice,
          stopPrice: trailingStopPrice,
          lowWaterMark: metrics.lowWaterMark,
          reason: 'Trailing stop triggered (SHORT)',
        });
      }
    }
  }

  /**
   * Close position
   */
  async closePosition(symbol: string, reason: string): Promise<void> {
    const position = this.positions.get(symbol);
    if (!position) {
      logger.warn('Attempted to close non-existent position', { symbol });
      return;
    }

    try {
      logger.info('Closing position', {
        symbol,
        side: position.side,
        size: position.size.toNumber(),
        unrealizedPnl: position.unrealizedPnl.toNumber(),
        reason,
      });

      // Place market order to close position
      const closeOrder = await this.client.placeOrder({
        symbol,
        side: position.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY,
        type: 'market' as any,
        amount: position.size,
      });

      tradingLogger.info('Position close order placed', {
        symbol,
        orderId: closeOrder.id,
        reason,
      });

      this.emit('positionClosed', { position, closeOrder, reason });

    } catch (error) {
      logger.error('Failed to close position', { error, symbol, reason });
      this.emit('positionCloseError', { symbol, error, reason });
    }
  }

  /**
   * Get position metrics
   */
  getPositionMetrics(symbol: string): PositionMetrics | null {
    return this.positionMetrics.get(symbol) || null;
  }

  /**
   * Get all positions
   */
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position summary
   */
  getPositionSummary(): {
    totalPositions: number;
    totalValue: Decimal;
    totalUnrealizedPnl: Decimal;
    longsCount: number;
    shortsCount: number;
    avgHoldTime: number;
  } {
    const positions = Array.from(this.positions.values());
    const now = Date.now();
    
    let totalValue = new Decimal(0);
    let totalUnrealizedPnl = new Decimal(0);
    let longsCount = 0;
    let shortsCount = 0;
    let totalHoldTime = 0;

    positions.forEach(position => {
      totalValue = totalValue.plus(position.size.multipliedBy(position.markPrice));
      totalUnrealizedPnl = totalUnrealizedPnl.plus(position.unrealizedPnl);
      
      if (position.side === OrderSide.BUY) {
        longsCount++;
      } else {
        shortsCount++;
      }

      const metrics = this.positionMetrics.get(position.symbol);
      if (metrics) {
        totalHoldTime += now - metrics.entryTime;
      }
    });

    const avgHoldTime = positions.length > 0 ? totalHoldTime / positions.length / (1000 * 60) : 0; // in minutes

    return {
      totalPositions: positions.length,
      totalValue,
      totalUnrealizedPnl,
      longsCount,
      shortsCount,
      avgHoldTime,
    };
  }
}

interface PositionMetrics {
  symbol: string;
  entryTime: number;
  entryPrice: Decimal;
  maxFavorableExcursion: Decimal;
  maxAdverseExcursion: Decimal;
  highWaterMark: Decimal;
  lowWaterMark: Decimal;
  layerCount: number;
  avgEntryPrice: Decimal;
  totalSize: Decimal;
}

// === src/core/order-manager.ts ===
import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { logger, tradingLogger } from '@/utils/logger';
import { Order, OrderStatus, OrderType, OrderSide } from '@/types';
import { HyperliquidClient } from '@/api/hyperliquid-api';

export interface OrderManagerConfig {
  maxOrderAge: number; // Maximum age in milliseconds
  orderCheckInterval: number; // Interval for checking order status
  maxRetries: number; // Maximum retries for failed orders
  fillTimeout: number; // Timeout for order fills
}

export class OrderManager extends EventEmitter {
  private config: OrderManagerConfig;
  private client: HyperliquidClient;
  private activeOrders: Map<string, Order> = new Map();
  private orderHistory: Array<Order> = new Map();
  private orderTimers: Map<string, NodeJS.Timeout> = new Map();
  private fillExpectations: Map<string, { expectedFillRate: Decimal; placedAt: number }> = new Map();

  constructor(config: OrderManagerConfig, client: HyperliquidClient) {
    super();
    this.config = config;
    this.client = client;
    
    this.startOrderMonitoring();
  }

  /**
   * Submit a new order
   */
  async submitOrder(orderParams: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    amount: Decimal;
    price?: Decimal;
    stopPrice?: Decimal;
    timeInForce?: string;
    clientOrderId?: string;
    expectedFillRate?: Decimal;
  }): Promise<Order> {
    try {
      const order = await this.client.placeOrder(orderParams);
      
      // Track the order
      this.activeOrders.set(order.id, order);
      
      // Set order timeout
      this.setOrderTimeout(order);
      
      // Track fill expectations
      if (orderParams.expectedFillRate) {
        this.fillExpectations.set(order.id, {
          expectedFillRate: orderParams.expectedFillRate,
          placedAt: Date.now(),
        });
      }

      tradingLogger.info('Order submitted', {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        amount: order.amount.toNumber(),
        price: order.price?.toNumber(),
      });

      this.emit('orderSubmitted', order);
      return order;

    } catch (error) {
      logger.error('Failed to submit order', { error, orderParams });
      throw error;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.activeOrders.get(orderId);
    if (!order) {
      logger.warn('Attempted to cancel non-existent order', { orderId });
      return false;
    }

    try {
      const success = await this.client.cancelOrder(orderId, order.symbol);
      
      if (success) {
        order.status = OrderStatus.CANCELLED;
        this.activeOrders.delete(orderId);
        this.clearOrderTimeout(orderId);
        this.fillExpectations.delete(orderId);
        
        tradingLogger.info('Order cancelled', {
          orderId,
          symbol: order.symbol,
        });

        this.emit('orderCancelled', order);
      }

      return success;

    } catch (error) {
      logger.error('Failed to cancel order', { error, orderId });
      return false;
    }
  }

  /**
   * Update order status
   */
  updateOrderStatus(orderId: string, status: OrderStatus, filled?: Decimal): void {
    const order = this.activeOrders.get(orderId);
    if (!order) return;

    const previousStatus = order.status;
    order.status = status;
    order.updatedAt = Date.now();

    if (filled) {
      order.filled = filled;
      order.remaining = order.amount.minus(filled);
    }

    // Handle status changes
    if (status === OrderStatus.FILLED || status === OrderStatus.PARTIALLY_FILLED) {
      this.handleOrderFill(order);
    }

    if (status === OrderStatus.FILLED || status === OrderStatus.CANCELLED || status === OrderStatus.REJECTED) {
      this.activeOrders.delete(orderId);
      this.clearOrderTimeout(orderId);
      this.fillExpectations.delete(orderId);
      this.orderHistory.push(order);
    }

    tradingLogger.info('Order status updated', {
      orderId,
      previousStatus,
      newStatus: status,
      filled: filled?.toNumber(),
    });

    this.emit('orderStatusChanged', { order, previousStatus });
  }

  /**
   * Handle order fill
   */
  private handleOrderFill(order: Order): void {
    const fillSize = order.filled;
    const fillPrice = order.price || new Decimal(0);

    // Calculate rebates for maker orders
    if (order.maker && order.type === OrderType.LIMIT) {
      // Hyperliquid maker rebate: 0.0030%
      const rebateAmount = fillSize.multipliedBy(fillPrice).multipliedBy(0.00003);
      order.rebates = order.rebates.plus(rebateAmount);
    } else {
      // Taker fee: typically 0.05%
      const feeAmount = fillSize.multipliedBy(fillPrice).multipliedBy(0.0005);
      order.fees = order.fees.plus(feeAmount);
    }

    tradingLogger.info('Order fill processed', {
      orderId: order.id,
      symbol: order.symbol,
      fillSize: fillSize.toNumber(),
      fillPrice: fillPrice.toNumber(),
      rebates: order.rebates.toNumber(),
      fees: order.fees.toNumber(),
      maker: order.maker,
    });

    this.emit('orderFilled', { order, fillSize, fillPrice });
  }

  /**
   * Set order timeout
   */
  private setOrderTimeout(order: Order): void {
    const timer = setTimeout(() => {
      this.handleOrderTimeout(order.id);
    }, this.config.maxOrderAge);

    this.orderTimers.set(order.id, timer);
  }

  /**
   * Handle order timeout
   */
  private async handleOrderTimeout(orderId: string): Promise<void> {
    const order = this.activeOrders.get(orderId);
    if (!order) return;

    logger.warn('Order timeout reached', {
      orderId,
      symbol: order.symbol,
      age: Date.now() - order.timestamp,
    });

    // Automatically cancel aged orders
    await this.cancelOrder(orderId);
    
    this.emit('orderTimeout', order);
  }

  /**
   * Clear order timeout
   */
  private clearOrderTimeout(orderId: string): void {
    const timer = this.orderTimers.get(orderId);
    if (timer) {
      clearTimeout(timer);
      this.orderTimers.delete(orderId);
    }
  }

  /**
   * Start order monitoring
   */
  private startOrderMonitoring(): void {
    setInterval(() => {
      this.checkOrderPerformance();
      this.syncOrderStatus();
    }, this.config.orderCheckInterval);
  }

  /**
   * Check order performance against expectations
   */
  private checkOrderPerformance(): void {
    const now = Date.now();
    
    this.fillExpectations.forEach((expectation, orderId) => {
      const order = this.activeOrders.get(orderId);
      if (!order) return;

      const timeElapsed = now - expectation.placedAt;
      const expectedTimeToFill = 1 / expectation.expectedFillRate.toNumber() * 1000; // milliseconds

      if (timeElapsed > expectedTimeToFill * 2) { // Allow 2x expected time
        logger.warn('Order underperforming fill expectations', {
          orderId,
          symbol: order.symbol,
          expectedFillRate: expectation.expectedFillRate.toNumber(),
          timeElapsed,
          expectedTimeToFill,
        });

        this.emit('orderUnderperforming', {
          order,
          expectedFillRate: expectation.expectedFillRate,
          timeElapsed,
        });
      }
    });
  }

  /**
   * Sync order status with exchange
   */
  private async syncOrderStatus(): Promise<void> {
    try {
      const exchangeOrders = await this.client.getOpenOrders();
      const exchangeOrderIds = new Set(exchangeOrders.map(order => order.id));

      // Check for orders that no longer exist on exchange
      this.activeOrders.forEach((order, orderId) => {
        if (!exchangeOrderIds.has(orderId)) {
          // Order was filled or cancelled on exchange
          logger.info('Order status sync: order no longer on exchange', {
            orderId,
            symbol: order.symbol,
          });
          
          // Assume filled for now - would need to check trade history
          this.updateOrderStatus(orderId, OrderStatus.FILLED);
        }
      });

    } catch (error) {
      logger.error('Failed to sync order status', error);
    }
  }

  /**
   * Get active orders
   */
  getActiveOrders(): Order[] {
    return Array.from(this.activeOrders.values());
  }

  /**
   * Get orders for a specific symbol
   */
  getOrdersBySymbol(symbol: string): Order[] {
    return Array.from(this.activeOrders.values()).filter(order => order.symbol === symbol);
  }

  /**
   * Get order by ID
   */
  getOrder(orderId: string): Order | null {
    return this.activeOrders.get(orderId) || null;
  }

  /**
   * Cancel all orders
   */
  async cancelAllOrders(): Promise<void> {
    const orderIds = Array.from(this.activeOrders.keys());
    
    logger.info('Cancelling all orders', { count: orderIds.length });

    for (const orderId of orderIds) {
      try {
        await this.cancelOrder(orderId);
      } catch (error) {
        logger.error('Failed to cancel order during mass cancellation', { error, orderId });
      }
    }
  }

  /**
   * Cancel orders for a specific symbol
   */
  async cancelOrdersBySymbol(symbol: string): Promise<void> {
    const symbolOrders = this.getOrdersBySymbol(symbol);
    
    logger.info('Cancelling orders for symbol', { symbol, count: symbolOrders.length });

    for (const order of symbolOrders) {
      try {
        await this.cancelOrder(order.id);
      } catch (error) {
        logger.error('Failed to cancel order', { error, orderId: order.id, symbol });
      }
    }
  }

  /**
   * Get order statistics
   */
  getOrderStatistics(): {
    activeOrders: number;
    totalOrdersToday: number;
    fillRate: Decimal;
    avgFillTime: number;
    cancelRate: Decimal;
  } {
    const todayStart = TimeUtils.startOfDay();
    const todayOrders = this.orderHistory.filter(order => order.timestamp >= todayStart);
    
    const filledOrders = todayOrders.filter(order => order.status === OrderStatus.FILLED);
    const cancelledOrders = todayOrders.filter(order => order.status === OrderStatus.CANCELLED);
    
    const fillRate = todayOrders.length > 0 
      ? new Decimal(filledOrders.length).dividedBy(todayOrders.length) 
      : new Decimal(0);
    
    const cancelRate = todayOrders.length > 0 
      ? new Decimal(cancelledOrders.length).dividedBy(todayOrders.length) 
      : new Decimal(0);

    // Calculate average fill time
    let totalFillTime = 0;
    filledOrders.forEach(order => {
      totalFillTime += order.updatedAt - order.timestamp;
    });
    const avgFillTime = filledOrders.length > 0 ? totalFillTime / filledOrders.length : 0;

    return {
      activeOrders: this.activeOrders.size,
      totalOrdersToday: todayOrders.length,
      fillRate,
      avgFillTime,
      cancelRate,
    };
  }
}