import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { logger, auditLogger } from '@/utils/logger';
import { TimeUtils } from '@/utils/time';
import { MathUtils } from '@/utils/math';
import { 
  RiskMetrics, 
  RiskLimits, 
  RiskAlert, 
  Portfolio, 
  Position, 
  Order, 
  OrderSide 
} from '@/types';

export interface RiskConfig {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxDrawdownPercent: number;
  positionTimeoutMinutes: number;
  riskCheckIntervalMs: number;
  emergencyStopLossPercent: number;
  concentrationLimit: number;
  maxOpenPositions: number;
  correlationLimit: number;
  volatilityThreshold: number;
}

export class RiskManager extends EventEmitter {
  private config: RiskConfig;
  private limits: RiskLimits;
  private portfolio: Portfolio;
  private positions: Map<string, Position> = new Map();
  private pendingOrders: Map<string, Order> = new Map();
  private dailyTrades: Array<{ timestamp: number; pnl: Decimal; symbol: string }> = [];
  private riskMetrics: RiskMetrics;
  private emergencyStop = false;
  private lastRiskCheck = 0;
  private drawdownHistory: Array<{ timestamp: number; drawdown: Decimal }> = [];
  private positionTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: RiskConfig) {
    super();
    this.config = config;
    this.limits = this.createRiskLimits();
    this.portfolio = this.initializePortfolio();
    this.riskMetrics = this.initializeRiskMetrics();
    
    this.startRiskMonitoring();
  }

  private createRiskLimits(): RiskLimits {
    return {
      maxPositionSize: new Decimal(this.config.maxPositionSize),
      maxDailyLoss: new Decimal(this.config.maxDailyLoss),
      maxDrawdownPercent: new Decimal(this.config.maxDrawdownPercent),
      maxOpenPositions: this.config.maxOpenPositions || 10,
      positionTimeoutMinutes: this.config.positionTimeoutMinutes,
      emergencyStopLossPercent: new Decimal(this.config.emergencyStopLossPercent),
      concentrationLimit: new Decimal(this.config.concentrationLimit || 0.3),
    };
  }

  private initializePortfolio(): Portfolio {
    return {
      totalValue: new Decimal(10000), // Starting capital
      cash: new Decimal(10000),
      positions: [],
      unrealizedPnl: new Decimal(0),
      realizedPnl: new Decimal(0),
      totalFees: new Decimal(0),
      totalRebates: new Decimal(0),
      netPnl: new Decimal(0),
    };
  }

  private initializeRiskMetrics(): RiskMetrics {
    return {
      totalExposure: new Decimal(0),
      maxPositionSize: this.limits.maxPositionSize,
      currentDrawdown: new Decimal(0),
      maxDrawdown: new Decimal(0),
      dailyPnl: new Decimal(0),
      dailyLoss: new Decimal(0),
      sharpeRatio: new Decimal(0),
      winRate: new Decimal(0),
      avgWin: new Decimal(0),
      avgLoss: new Decimal(0),
      profitFactor: new Decimal(0),
    };
  }

  /**
   * Check if trading is allowed for a symbol
   */
  canTrade(symbol: string): boolean {
    if (this.emergencyStop) {
      logger.debug('Trading blocked by emergency stop', { symbol });
      return false;
    }

    // Check daily loss limit
    if (this.riskMetrics.dailyLoss.abs().greaterThanOrEqualTo(this.limits.maxDailyLoss)) {
      logger.debug('Trading blocked by daily loss limit', { 
        symbol, 
        dailyLoss: this.riskMetrics.dailyLoss.toNumber(),
        limit: this.limits.maxDailyLoss.toNumber() 
      });
      return false;
    }

    // Check drawdown limit
    if (this.riskMetrics.currentDrawdown.greaterThanOrEqualTo(this.limits.maxDrawdownPercent)) {
      logger.debug('Trading blocked by drawdown limit', { 
        symbol, 
        drawdown: this.riskMetrics.currentDrawdown.toNumber(),
        limit: this.limits.maxDrawdownPercent.toNumber() 
      });
      return false;
    }

    // Check position concentration
    const position = this.positions.get(symbol);
    if (position) {
      const exposurePercent = position.size.multipliedBy(position.markPrice)
        .dividedBy(this.portfolio.totalValue)
        .multipliedBy(100);
      
      if (exposurePercent.greaterThan(this.limits.concentrationLimit.multipliedBy(100))) {
        logger.debug('Trading blocked by concentration limit', { 
          symbol, 
          exposure: exposurePercent.toNumber(),
          limit: this.limits.concentrationLimit.multipliedBy(100).toNumber() 
        });
        return false;
      }
    }

    // Check maximum open positions
    if (this.positions.size >= this.limits.maxOpenPositions) {
      logger.debug('Trading blocked by max open positions', { 
        symbol, 
        openPositions: this.positions.size,
        limit: this.limits.maxOpenPositions 
      });
      return false;
    }

    return true;
  }

  /**
   * Get maximum allowed position size for a symbol
   */
  getMaxPositionSize(symbol: string, requestedSize: Decimal): Decimal {
    const currentPosition = this.positions.get(symbol);
    const currentSize = currentPosition ? currentPosition.size : new Decimal(0);
    
    // Check absolute position limit
    let maxSize = this.limits.maxPositionSize.minus(currentSize);
    
    // Check concentration limit
    const portfolioValue = this.portfolio.totalValue;
    const maxConcentrationValue = portfolioValue.multipliedBy(this.limits.concentrationLimit);
    
    // Estimate current market value (using mid-price approximation)
    const estimatedPrice = new Decimal(2000); // Should get from market data
    const maxConcentrationSize = maxConcentrationValue.dividedBy(estimatedPrice);
    
    maxSize = Decimal.min(maxSize, maxConcentrationSize);
    
    // Check daily loss impact
    const potentialLoss = requestedSize.multipliedBy(estimatedPrice).multipliedBy(0.1); // 10% potential loss
    const remainingDailyLoss = this.limits.maxDailyLoss.minus(this.riskMetrics.dailyLoss.abs());
    
    if (potentialLoss.greaterThan(remainingDailyLoss)) {
      const safeSizeFromLoss = remainingDailyLoss.dividedBy(estimatedPrice.multipliedBy(0.1));
      maxSize = Decimal.min(maxSize, safeSizeFromLoss);
    }

    return Decimal.max(maxSize, new Decimal(0));
  }

  /**
   * Update position information
   */
  updatePosition(position: Position): void {
    const previousPosition = this.positions.get(position.symbol);
    this.positions.set(position.symbol, position);
    
    // Set position timeout
    this.setPositionTimeout(position);
    
    // Update portfolio
    this.updatePortfolio();
    
    // Update risk metrics
    this.updateRiskMetrics();
    
    // Check for risk alerts
    this.checkRiskLimits(position.symbol);
    
    auditLogger.info('Position updated', {
      symbol: position.symbol,
      side: position.side,
      size: position.size.toNumber(),
      unrealizedPnl: position.unrealizedPnl.toNumber(),
      previous: previousPosition ? {
        size: previousPosition.size.toNumber(),
        unrealizedPnl: previousPosition.unrealizedPnl.toNumber(),
      } : null,
    });
  }

  /**
   * Add pending order for risk tracking
   */
  addPendingOrder(order: Order): void {
    this.pendingOrders.set(order.id, order);
    this.updateRiskMetrics();
    
    auditLogger.info('Pending order added', {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      size: order.amount.toNumber(),
      price: order.price?.toNumber(),
    });
  }

  /**
   * Remove pending order
   */
  removePendingOrder(orderId: string): void {
    const order = this.pendingOrders.get(orderId);
    if (order) {
      this.pendingOrders.delete(orderId);
      this.updateRiskMetrics();
      
      auditLogger.info('Pending order removed', {
        orderId,
        symbol: order.symbol,
      });
    }
  }

  /**
   * Process order fill
   */
  processOrderFill(order: Order, fillPrice: Decimal, fillSize: Decimal): void {
    const trade = {
      timestamp: Date.now(),
      symbol: order.symbol,
      side: order.side,
      size: fillSize,
      price: fillPrice,
      fees: order.fees,
      rebates: order.rebates,
      pnl: new Decimal(0), // Will be calculated based on position
    };

    // Update position
    this.updatePositionFromFill(trade);
    
    // Track daily trades
    this.dailyTrades.push({
      timestamp: trade.timestamp,
      pnl: trade.pnl,
      symbol: trade.symbol,
    });
    
    // Add rebate earnings
    this.addRebateEarnings(order.rebates);
    
    // Remove from pending orders
    this.removePendingOrder(order.id);
    
    auditLogger.info('Order fill processed', {
      orderId: order.id,
      symbol: trade.symbol,
      side: trade.side,
      fillSize: fillSize.toNumber(),
      fillPrice: fillPrice.toNumber(),
      rebates: order.rebates.toNumber(),
    });
  }

  /**
   * Add rebate earnings
   */
  addRebateEarnings(rebateAmount: Decimal): void {
    this.portfolio.totalRebates = this.portfolio.totalRebates.plus(rebateAmount);
    this.portfolio.cash = this.portfolio.cash.plus(rebateAmount);
    this.updateNetPnl();
    
    logger.debug('Rebate earnings added', {
      amount: rebateAmount.toNumber(),
      totalRebates: this.portfolio.totalRebates.toNumber(),
    });
  }

  /**
   * Set position timeout for automatic management
   */
  private setPositionTimeout(position: Position): void {
    const existingTimer = this.positionTimers.get(position.symbol);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timeoutMs = this.limits.positionTimeoutMinutes * 60 * 1000;
    const timer = setTimeout(() => {
      this.handlePositionTimeout(position.symbol);
    }, timeoutMs);

    this.positionTimers.set(position.symbol, timer);
  }

  /**
   * Handle position timeout
   */
  private async handlePositionTimeout(symbol: string): Promise<void> {
    const position = this.positions.get(symbol);
    if (!position) return;

    logger.warn('Position timeout reached', {
      symbol,
      size: position.size.toNumber(),
      unrealizedPnl: position.unrealizedPnl.toNumber(),
      timeoutMinutes: this.limits.positionTimeoutMinutes,
    });

    // Emit alert for position management
    this.emitRiskAlert({
      level: 'WARNING',
      type: 'POSITION_TIMEOUT',
      message: `Position timeout reached for ${symbol}`,
      symbol,
      value: new Decimal(this.limits.positionTimeoutMinutes),
      limit: new Decimal(this.limits.positionTimeoutMinutes),
      action: 'REDUCE_POSITION',
    });
  }

  /**
   * Update portfolio from positions
   */
  private updatePortfolio(): void {
    let totalPositionValue = new Decimal(0);
    let totalUnrealizedPnl = new Decimal(0);
    const positionArray: Position[] = [];

    this.positions.forEach(position => {
      const positionValue = position.size.multipliedBy(position.markPrice);
      totalPositionValue = totalPositionValue.plus(positionValue);
      totalUnrealizedPnl = totalUnrealizedPnl.plus(position.unrealizedPnl);
      positionArray.push(position);
    });

    this.portfolio.positions = positionArray;
    this.portfolio.unrealizedPnl = totalUnrealizedPnl;
    this.portfolio.totalValue = this.portfolio.cash.plus(totalPositionValue).plus(totalUnrealizedPnl);
    this.updateNetPnl();
  }

  /**
   * Update net P&L calculation
   */
  private updateNetPnl(): void {
    this.portfolio.netPnl = this.portfolio.realizedPnl
      .plus(this.portfolio.unrealizedPnl)
      .plus(this.portfolio.totalRebates)
      .minus(this.portfolio.totalFees);
  }

  /**
   * Update risk metrics
   */
  private updateRiskMetrics(): void {
    // Calculate total exposure
    let totalExposure = new Decimal(0);
    this.positions.forEach(position => {
      const exposure = position.size.multipliedBy(position.markPrice);
      totalExposure = totalExposure.plus(exposure);
    });
    this.riskMetrics.totalExposure = totalExposure;

    // Calculate daily P&L
    const todayStart = TimeUtils.startOfDay();
    const todayTrades = this.dailyTrades.filter(trade => trade.timestamp >= todayStart);
    
    this.riskMetrics.dailyPnl = todayTrades.reduce(
      (sum, trade) => sum.plus(trade.pnl), 
      new Decimal(0)
    );
    
    this.riskMetrics.dailyLoss = this.riskMetrics.dailyPnl.lessThan(0) 
      ? this.riskMetrics.dailyPnl.abs() 
      : new Decimal(0);

    // Calculate current drawdown
    const initialCapital = new Decimal(10000); // Should be configurable
    const currentCapital = this.portfolio.totalValue;
    const peakCapital = this.getHistoricalPeak();
    
    this.riskMetrics.currentDrawdown = peakCapital.greaterThan(currentCapital)
      ? peakCapital.minus(currentCapital).dividedBy(peakCapital).multipliedBy(100)
      : new Decimal(0);

    // Update max drawdown
    if (this.riskMetrics.currentDrawdown.greaterThan(this.riskMetrics.maxDrawdown)) {
      this.riskMetrics.maxDrawdown = this.riskMetrics.currentDrawdown;
    }

    // Track drawdown history
    this.drawdownHistory.push({
      timestamp: Date.now(),
      drawdown: this.riskMetrics.currentDrawdown,
    });

    // Keep only last 1000 entries
    if (this.drawdownHistory.length > 1000) {
      this.drawdownHistory.splice(0, this.drawdownHistory.length - 1000);
    }

    // Calculate performance metrics
    this.calculatePerformanceMetrics();
  }

  /**
   * Calculate performance metrics
   */
  private calculatePerformanceMetrics(): void {
    if (this.dailyTrades.length === 0) return;

    const wins = this.dailyTrades.filter(trade => trade.pnl.greaterThan(0));
    const losses = this.dailyTrades.filter(trade => trade.pnl.lessThan(0));

    this.riskMetrics.winRate = new Decimal(wins.length).dividedBy(this.dailyTrades.length);
    
    if (wins.length > 0) {
      this.riskMetrics.avgWin = wins.reduce(
        (sum, trade) => sum.plus(trade.pnl), 
        new Decimal(0)
      ).dividedBy(wins.length);
    }

    if (losses.length > 0) {
      this.riskMetrics.avgLoss = losses.reduce(
        (sum, trade) => sum.plus(trade.pnl.abs()), 
        new Decimal(0)
      ).dividedBy(losses.length);
    }

    // Calculate profit factor
    const grossProfit = wins.reduce((sum, trade) => sum.plus(trade.pnl), new Decimal(0));
    const grossLoss = losses.reduce((sum, trade) => sum.plus(trade.pnl.abs()), new Decimal(0));
    
    this.riskMetrics.profitFactor = grossLoss.greaterThan(0) 
      ? grossProfit.dividedBy(grossLoss) 
      : new Decimal(0);

    // Calculate Sharpe ratio (simplified)
    const returns = this.dailyTrades.map(trade => trade.pnl.dividedBy(this.portfolio.totalValue));
    this.riskMetrics.sharpeRatio = MathUtils.calculateSharpeRatio(returns);
  }

  /**
   * Check all risk limits and emit alerts if necessary
   */
  private checkRiskLimits(symbol?: string): void {
    const alerts: RiskAlert[] = [];
    const now = Date.now();

    // Check daily loss limit
    if (this.riskMetrics.dailyLoss.greaterThanOrEqualTo(this.limits.maxDailyLoss.multipliedBy(0.8))) {
      alerts.push({
        id: `daily_loss_${now}`,
        timestamp: now,
        level: this.riskMetrics.dailyLoss.greaterThanOrEqualTo(this.limits.maxDailyLoss) ? 'CRITICAL' : 'WARNING',
        type: 'DAILY_LOSS_LIMIT',
        message: 'Daily loss limit approached',
        value: this.riskMetrics.dailyLoss,
        limit: this.limits.maxDailyLoss,
        action: 'REDUCE_RISK',
      });
    }

    // Check drawdown limit
    if (this.riskMetrics.currentDrawdown.greaterThanOrEqualTo(this.limits.maxDrawdownPercent.multipliedBy(0.7))) {
      alerts.push({
        id: `drawdown_${now}`,
        timestamp: now,
        level: this.riskMetrics.currentDrawdown.greaterThanOrEqualTo(this.limits.maxDrawdownPercent) ? 'EMERGENCY' : 'WARNING',
        type: 'DRAWDOWN_LIMIT',
        message: 'Drawdown limit approached',
        value: this.riskMetrics.currentDrawdown,
        limit: this.limits.maxDrawdownPercent,
        action: 'EMERGENCY_STOP',
      });
    }

    // Check position concentration
    if (symbol) {
      const position = this.positions.get(symbol);
      if (position) {
        const exposurePercent = position.size.multipliedBy(position.markPrice)
          .dividedBy(this.portfolio.totalValue)
          .multipliedBy(100);
        
        if (exposurePercent.greaterThan(this.limits.concentrationLimit.multipliedBy(100).multipliedBy(0.8))) {
          alerts.push({
            id: `concentration_${symbol}_${now}`,
            timestamp: now,
            level: 'WARNING',
            type: 'CONCENTRATION_RISK',
            message: `High concentration in ${symbol}`,
            symbol,
            value: exposurePercent,
            limit: this.limits.concentrationLimit.multipliedBy(100),
            action: 'REDUCE_POSITION',
          });
        }
      }
    }

    // Check for correlated positions
    this.checkCorrelationRisk(alerts, now);

    // Emit alerts
    alerts.forEach(alert => {
      this.emitRiskAlert(alert);
    });
  }

  /**
   * Check correlation risk between positions
   */
  private checkCorrelationRisk(alerts: RiskAlert[], timestamp: number): void {
    // Simplified correlation check - in reality would use historical correlation data
    const cryptoSymbols = ['ETH', 'BTC', 'SOL', 'AVAX', 'MATIC'];
    let cryptoExposure = new Decimal(0);

    this.positions.forEach(position => {
      if (cryptoSymbols.includes(position.symbol)) {
        cryptoExposure = cryptoExposure.plus(position.size.multipliedBy(position.markPrice));
      }
    });

    const cryptoExposurePercent = cryptoExposure.dividedBy(this.portfolio.totalValue).multipliedBy(100);
    const correlationLimit = new Decimal(70); // 70% max correlated exposure

    if (cryptoExposurePercent.greaterThan(correlationLimit)) {
      alerts.push({
        id: `correlation_crypto_${timestamp}`,
        timestamp,
        level: 'WARNING',
        type: 'CORRELATION_RISK',
        message: 'High correlation exposure in crypto assets',
        value: cryptoExposurePercent,
        limit: correlationLimit,
        action: 'DIVERSIFY_POSITIONS',
      });
    }
  }

  /**
   * Update position from trade fill
   */
  private updatePositionFromFill(trade: any): void {
    const existingPosition = this.positions.get(trade.symbol);
    
    if (!existingPosition) {
      // New position
      const newPosition: Position = {
        symbol: trade.symbol,
        side: trade.side,
        size: trade.size,
        entryPrice: trade.price,
        markPrice: trade.price,
        unrealizedPnl: new Decimal(0),
        realizedPnl: new Decimal(0),
        timestamp: trade.timestamp,
        fees: trade.fees,
        rebates: trade.rebates,
      };
      
      this.positions.set(trade.symbol, newPosition);
    } else {
      // Update existing position
      if (existingPosition.side === trade.side) {
        // Same side - increase position
        const totalSize = existingPosition.size.plus(trade.size);
        const weightedPrice = existingPosition.entryPrice.multipliedBy(existingPosition.size)
          .plus(trade.price.multipliedBy(trade.size))
          .dividedBy(totalSize);
        
        existingPosition.size = totalSize;
        existingPosition.entryPrice = weightedPrice;
        existingPosition.fees = existingPosition.fees.plus(trade.fees);
        existingPosition.rebates = existingPosition.rebates.plus(trade.rebates);
      } else {
        // Opposite side - reduce or reverse position
        if (trade.size.greaterThanOrEqualTo(existingPosition.size)) {
          // Reverse position
          const newSize = trade.size.minus(existingPosition.size);
          const realizedPnl = this.calculateRealizedPnl(existingPosition, trade.price);
          
          existingPosition.side = trade.side;
          existingPosition.size = newSize;
          existingPosition.entryPrice = trade.price;
          existingPosition.realizedPnl = existingPosition.realizedPnl.plus(realizedPnl);
          
          // Track realized PnL
          this.portfolio.realizedPnl = this.portfolio.realizedPnl.plus(realizedPnl);
          trade.pnl = realizedPnl;
        } else {
          // Reduce position
          const realizedPnl = this.calculateRealizedPnl(existingPosition, trade.price, trade.size);
          existingPosition.size = existingPosition.size.minus(trade.size);
          existingPosition.realizedPnl = existingPosition.realizedPnl.plus(realizedPnl);
          
          this.portfolio.realizedPnl = this.portfolio.realizedPnl.plus(realizedPnl);
          trade.pnl = realizedPnl;
        }
        
        existingPosition.fees = existingPosition.fees.plus(trade.fees);
        existingPosition.rebates = existingPosition.rebates.plus(trade.rebates);
      }
      
      // Remove position if size is zero
      if (existingPosition.size.isZero()) {
        this.positions.delete(trade.symbol);
        this.clearPositionTimeout(trade.symbol);
      }
    }
  }

  /**
   * Calculate realized PnL from a trade
   */
  private calculateRealizedPnl(position: Position, exitPrice: Decimal, size?: Decimal): Decimal {
    const closeSize = size || position.size;
    const priceDiff = position.side === OrderSide.BUY 
      ? exitPrice.minus(position.entryPrice)
      : position.entryPrice.minus(exitPrice);
    
    return priceDiff.multipliedBy(closeSize);
  }

  /**
   * Clear position timeout
   */
  private clearPositionTimeout(symbol: string): void {
    const timer = this.positionTimers.get(symbol);
    if (timer) {
      clearTimeout(timer);
      this.positionTimers.delete(symbol);
    }
  }

  /**
   * Get historical peak capital
   */
  private getHistoricalPeak(): Decimal {
    // In a real implementation, this would track historical peaks
    // For now, return current total value or initial capital, whichever is higher
    const initialCapital = new Decimal(10000);
    return Decimal.max(this.portfolio.totalValue, initialCapital);
  }

  /**
   * Start risk monitoring
   */
  private startRiskMonitoring(): void {
    setInterval(() => {
      if (Date.now() - this.lastRiskCheck >= this.config.riskCheckIntervalMs) {
        this.performRiskCheck();
        this.lastRiskCheck = Date.now();
      }
    }, this.config.riskCheckIntervalMs);
  }

  /**
   * Perform comprehensive risk check
   */
  private performRiskCheck(): void {
    try {
      this.updateRiskMetrics();
      this.checkRiskLimits();
      this.cleanupOldData();
      
      // Log risk status
      if (this.lastRiskCheck % 30000 === 0) { // Every 30 seconds
        logger.debug('Risk check completed', {
          totalExposure: this.riskMetrics.totalExposure.toNumber(),
          dailyPnl: this.riskMetrics.dailyPnl.toNumber(),
          currentDrawdown: this.riskMetrics.currentDrawdown.toNumber(),
          positions: this.positions.size,
          emergencyStop: this.emergencyStop,
        });
      }
    } catch (error) {
      logger.error('Error in risk check', error);
    }
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    const oneDayAgo = TimeUtils.subtractTime(Date.now(), 1, 'day');
    
    // Clean up old daily trades
    this.dailyTrades = this.dailyTrades.filter(trade => trade.timestamp > oneDayAgo);
    
    // Clean up old drawdown history
    this.drawdownHistory = this.drawdownHistory.filter(entry => entry.timestamp > oneDayAgo);
  }

  /**
   * Emit risk alert
   */
  private emitRiskAlert(alert: Omit<RiskAlert, 'id' | 'timestamp'>): void {
    const fullAlert: RiskAlert = {
      id: `${alert.type}_${Date.now()}`,
      timestamp: Date.now(),
      ...alert,
    };

    logger.warn('Risk alert emitted', fullAlert);
    auditLogger.warn('Risk alert', fullAlert);
    
    this.emit('riskAlert', fullAlert);

    // Handle critical alerts automatically
    if (fullAlert.level === 'EMERGENCY') {
      this.triggerEmergencyStop(fullAlert);
    }
  }

  /**
   * Trigger emergency stop
   */
  private triggerEmergencyStop(alert: RiskAlert): void {
    if (this.emergencyStop) return;

    logger.error('EMERGENCY STOP TRIGGERED', alert);
    auditLogger.error('Emergency stop triggered', alert);
    
    this.emergencyStop = true;
    this.emit('emergencyStop', alert);

    // Additional emergency actions could be implemented here
    // - Close all positions
    // - Cancel all orders
    // - Send immediate alerts
    // - Disable trading
  }

  /**
   * Reset emergency stop (manual intervention required)
   */
  resetEmergencyStop(): void {
    logger.info('Emergency stop reset');
    auditLogger.info('Emergency stop reset by manual intervention');
    this.emergencyStop = false;
    this.emit('emergencyStopReset');
  }

  /**
   * Get current risk metrics
   */
  getRiskMetrics(): RiskMetrics {
    return { ...this.riskMetrics };
  }

  /**
   * Get current portfolio
   */
  getPortfolio(): Portfolio {
    return { ...this.portfolio };
  }

  /**
   * Get risk limits
   */
  getRiskLimits(): RiskLimits {
    return { ...this.limits };
  }

  /**
   * Get position for a symbol
   */
  getPosition(symbol: string): Position | null {
    return this.positions.get(symbol) || null;
  }

  /**
   * Get all positions
   */
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get emergency stop status
   */
  isEmergencyStop(): boolean {
    return this.emergencyStop;
  }

  /**
   * Update risk limits (admin function)
   */
  updateRiskLimits(newLimits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
    logger.info('Risk limits updated', newLimits);
    auditLogger.info('Risk limits updated', newLimits);
  }

  /**
   * Force position closure (emergency function)
   */
  async forceClosePosition(symbol: string): Promise<void> {
    const position = this.positions.get(symbol);
    if (!position) return;

    logger.warn('Force closing position', {
      symbol,
      size: position.size.toNumber(),
      unrealizedPnl: position.unrealizedPnl.toNumber(),
    });

    // This would interface with the trading engine to close the position
    // For now, just remove it from tracking
    this.positions.delete(symbol);
    this.clearPositionTimeout(symbol);
    
    auditLogger.warn('Position force closed', { symbol });
  }

  /**
   * Get risk summary for reporting
   */
  getRiskSummary(): {
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
    metrics: RiskMetrics;
    limits: RiskLimits;
    positions: number;
    dailyTrades: number;
    emergencyStop: boolean;
  } {
    let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'EMERGENCY' = 'HEALTHY';

    if (this.emergencyStop) {
      status = 'EMERGENCY';
    } else if (this.riskMetrics.currentDrawdown.greaterThanOrEqualTo(this.limits.maxDrawdownPercent)) {
      status = 'CRITICAL';
    } else if (
      this.riskMetrics.dailyLoss.greaterThanOrEqualTo(this.limits.maxDailyLoss.multipliedBy(0.8)) ||
      this.riskMetrics.currentDrawdown.greaterThanOrEqualTo(this.limits.maxDrawdownPercent.multipliedBy(0.7))
    ) {
      status = 'WARNING';
    }

    return {
      status,
      metrics: this.getRiskMetrics(),
      limits: this.getRiskLimits(),
      positions: this.positions.size,
      dailyTrades: this.dailyTrades.length,
      emergencyStop: this.emergencyStop,
    };
  }
}