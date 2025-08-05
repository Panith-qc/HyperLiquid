import { Decimal } from 'decimal.js';
import { logger } from '@/utils/logger';
import { MathUtils } from '@/utils/math';
import { 
  BacktestResult, 
  TradeAnalysis, 
  PerformanceMetrics, 
  MarketData, 
  Signal, 
  Direction,
  OrderSide 
} from '@/types';
import { SignalGenerator } from '@/strategies/signal-generator';

export interface BacktestConfig {
  initialCapital: Decimal;
  commissionRate: Decimal;
  rebateRate: Decimal;
  slippageRate: Decimal;
  positionSizing: 'FIXED' | 'PERCENT' | 'VOLATILITY';
  fixedPositionSize?: Decimal;
  percentOfCapital?: Decimal;
  maxPositions: number;
  fillSimulation: 'CONSERVATIVE' | 'OPTIMISTIC' | 'REALISTIC';
}

export class Backtester {
  private config: BacktestConfig;
  private signalGenerator: SignalGenerator;
  private portfolio: BacktestPortfolio;
  private trades: TradeAnalysis[] = [];
  private dailyReturns: Decimal[] = [];
  private equityCurve: Decimal[] = [];

  constructor(config: BacktestConfig, signalGenerator: SignalGenerator) {
    this.config = {
      commissionRate: new Decimal(0.0005), // 0.05% taker fee
      rebateRate: new Decimal(-0.00003), // -0.003% maker rebate (negative = rebate)
      slippageRate: new Decimal(0.0001), // 0.01% slippage
      positionSizing: 'PERCENT',
      percentOfCapital: new Decimal(0.1), // 10% of capital per trade
      maxPositions: 5,
      fillSimulation: 'REALISTIC',
      ...config,
    };
    this.signalGenerator = signalGenerator;
    this.portfolio = {
      cash: config.initialCapital,
      totalValue: config.initialCapital,
      positions: new Map(),
      openOrders: new Map(),
    };
  }

  /**
   * Run backtest on historical data
   */
  async runBacktest(
    historicalData: MarketData[],
    startDate: number,
    endDate: number
  ): Promise<BacktestResult> {
    logger.info('Starting backtest', {
      dataPoints: historicalData.length,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      initialCapital: this.config.initialCapital.toNumber(),
    });

    // Filter data by date range
    const filteredData = historicalData.filter(
      data => data.timestamp >= startDate && data.timestamp <= endDate
    );

    // Reset portfolio
    this.resetPortfolio();

    // Process each data point
    for (let i = 0; i < filteredData.length; i++) {
      const marketData = filteredData[i];
      
      // Generate signal
      this.signalGenerator.processMarketData(marketData);
      const signal = this.signalGenerator.getLatestSignal(marketData.symbol);
      
      if (signal && this.shouldTrade(signal)) {
        await this.processBacktestSignal(signal, marketData);
      }

      // Update portfolio value
      this.updatePortfolioValue(marketData);
      
      // Record daily returns
      if (this.shouldRecordDailyReturn(marketData.timestamp)) {
        this.recordDailyReturn();
      }

      // Process fills (simulate order execution)
      this.processSimulatedFills(marketData);
    }

    // Generate final results
    const result = this.generateBacktestResult(startDate, endDate);
    
    logger.info('Backtest completed', {
      totalTrades: result.totalTrades,
      totalReturn: result.totalReturn.toNumber(),
      maxDrawdown: result.maxDrawdown.toNumber(),
      sharpeRatio: result.sharpeRatio.toNumber(),
      winRate: result.winRate.toNumber(),
    });

    return result;
  }

  /**
   * Process trading signal in backtest
   */
  private async processBacktestSignal(signal: Signal, marketData: MarketData): Promise<void> {
    try {
      if (signal.direction === Direction.NEUTRAL) return;

      const positionSize = this.calculatePositionSize(signal, marketData);
      if (positionSize.lessThanOrEqualTo(0)) return;

      const side = signal.direction === Direction.LONG ? OrderSide.BUY : OrderSide.SELL;
      const entryPrice = this.calculateEntryPrice(marketData, side);

      // Check if we can afford the trade
      const tradeValue = positionSize.multipliedBy(entryPrice);
      if (tradeValue.greaterThan(this.portfolio.cash)) {
        logger.debug('Insufficient capital for trade', {
          symbol: signal.symbol,
          tradeValue: tradeValue.toNumber(),
          availableCash: this.portfolio.cash.toNumber(),
        });
        return;
      }

      // Simulate order placement and fill
      const fillPrice = this.simulateFill(entryPrice, side, marketData);
      const actualSlippage = this.calculateSlippage(entryPrice, fillPrice);
      
      // Create trade
      const trade: TradeAnalysis = {
        id: `backtest_${Date.now()}_${Math.random()}`,
        symbol: signal.symbol,
        entryTime: marketData.timestamp,
        exitTime: 0, // Will be set when position is closed
        duration: 0,
        side,
        entryPrice: fillPrice,
        exitPrice: new Decimal(0),
        size: positionSize,
        pnl: new Decimal(0),
        pnlPercent: new Decimal(0),
        fees: this.calculateFees(positionSize, fillPrice, true), // Assume maker order
        rebates: this.calculateRebates(positionSize, fillPrice),
        netPnl: new Decimal(0),
        reason: signal.reason,
        signalStrength: signal.strength,
        maxFavorableExcursion: new Decimal(0),
        maxAdverseExcursion: new Decimal(0),
      };

      // Update portfolio
      this.portfolio.cash = this.portfolio.cash.minus(tradeValue);
      this.portfolio.positions.set(signal.symbol, {
        trade,
        entryPrice: fillPrice,
        currentPrice: fillPrice,
        unrealizedPnl: new Decimal(0),
      });

      logger.debug('Backtest trade opened', {
        symbol: signal.symbol,
        side,
        size: positionSize.toNumber(),
        price: fillPrice.toNumber(),
        confidence: signal.confidence.toNumber(),
      });

    } catch (error) {
      logger.error('Error processing backtest signal', { error, signal });
    }
  }

  /**
   * Calculate position size for backtest
   */
  private calculatePositionSize(signal: Signal, marketData: MarketData): Decimal {
    switch (this.config.positionSizing) {
      case 'FIXED':
        return this.config.fixedPositionSize || new Decimal(1);
      
      case 'PERCENT':
        const percentSize = this.portfolio.totalValue
          .multipliedBy(this.config.percentOfCapital || new Decimal(0.1))
          .dividedBy(marketData.price);
        return percentSize;
      
      case 'VOLATILITY':
        // Volatility-based sizing (simplified)
        const baseSize = this.portfolio.totalValue
          .multipliedBy(new Decimal(0.1))
          .dividedBy(marketData.price);
        const volatilityAdjustment = new Decimal(1).dividedBy(signal.strength.plus(new Decimal(0.5)));
        return baseSize.multipliedBy(volatilityAdjustment);
      
      default:
        return new Decimal(1);
    }
  }

  /**
   * Calculate entry price with spread consideration
   */
  private calculateEntryPrice(marketData: MarketData, side: OrderSide): Decimal {
    // For one-sided quoting, we want to be on the passive side
    if (side === OrderSide.BUY) {
      // Quote below best bid for maker rebate
      return marketData.bid.minus(marketData.spread.multipliedBy(0.1));
    } else {
      // Quote above best ask for maker rebate  
      return marketData.ask.plus(marketData.spread.multipliedBy(0.1));
    }
  }

  /**
   * Simulate order fill based on configuration
   */
  private simulateFill(orderPrice: Decimal, side: OrderSide, marketData: MarketData): Decimal {
    switch (this.config.fillSimulation) {
      case 'CONSERVATIVE':
        // Assume worse fill due to market impact
        const conservativeSlippage = this.config.slippageRate.multipliedBy(2);
        return side === OrderSide.BUY 
          ? orderPrice.plus(orderPrice.multipliedBy(conservativeSlippage))
          : orderPrice.minus(orderPrice.multipliedBy(conservativeSlippage));
      
      case 'OPTIMISTIC':
        // Assume perfect fill at order price
        return orderPrice;
      
      case 'REALISTIC':
      default:
        // Assume normal slippage
        return side === OrderSide.BUY 
          ? orderPrice.plus(orderPrice.multipliedBy(this.config.slippageRate))
          : orderPrice.minus(orderPrice.multipliedBy(this.config.slippageRate));
    }
  }

  /**
   * Calculate slippage
   */
  private calculateSlippage(expectedPrice: Decimal, actualPrice: Decimal): Decimal {
    return actualPrice.minus(expectedPrice).dividedBy(expectedPrice).abs();
  }

  /**
   * Calculate trading fees
   */
  private calculateFees(size: Decimal, price: Decimal, isMaker: boolean): Decimal {
    const rate = isMaker ? new Decimal(0) : this.config.commissionRate; // Makers don't pay fees
    return size.multipliedBy(price).multipliedBy(rate);
  }

  /**
   * Calculate rebates
   */
  private calculateRebates(size: Decimal, price: Decimal): Decimal {
    // Only makers get rebates
    return size.multipliedBy(price).multipliedBy(this.config.rebateRate.abs());
  }

  /**
   * Process simulated fills
   */
  private processSimulatedFills(marketData: MarketData): void {
    const position = this.portfolio.positions.get(marketData.symbol);
    if (!position) return;

    // Update current price and unrealized PnL
    position.currentPrice = marketData.price;
    
    const priceDiff = position.trade.side === OrderSide.BUY
      ? marketData.price.minus(position.entryPrice)
      : position.entryPrice.minus(marketData.price);
    
    position.unrealizedPnl = priceDiff.multipliedBy(position.trade.size);

    // Update max favorable/adverse excursion
    if (position.unrealizedPnl.greaterThan(position.trade.maxFavorableExcursion)) {
      position.trade.maxFavorableExcursion = position.unrealizedPnl;
    }
    
    const adverseExcursion = position.unrealizedPnl.lessThan(0) ? position.unrealizedPnl.abs() : new Decimal(0);
    if (adverseExcursion.greaterThan(position.trade.maxAdverseExcursion)) {
      position.trade.maxAdverseExcursion = adverseExcursion;
    }

    // Check exit conditions
    this.checkBacktestExitConditions(position, marketData);
  }

  /**
   * Check exit conditions for backtest
   */
  private checkBacktestExitConditions(position: BacktestPosition, marketData: MarketData): void {
    let shouldExit = false;
    let exitReason = '';

    // Time-based exit (maximum hold time)
    const holdTime = marketData.timestamp - position.trade.entryTime;
    if (holdTime > 30 * 60 * 1000) { // 30 minutes max hold
      shouldExit = true;
      exitReason = 'Time-based exit';
    }

    // Profit target (2% gain)
    const pnlPercent = position.unrealizedPnl
      .dividedBy(position.entryPrice.multipliedBy(position.trade.size))
      .multipliedBy(100);
    
    if (pnlPercent.greaterThanOrEqualTo(2)) {
      shouldExit = true;
      exitReason = 'Profit target hit';
    }

    // Stop loss (1% loss)
    if (pnlPercent.lessThanOrEqualTo(-1)) {
      shouldExit = true;
      exitReason = 'Stop loss hit';
    }

    if (shouldExit) {
      this.closeBacktestPosition(position, marketData, exitReason);
    }
  }

  /**
   * Close position in backtest
   */
  private closeBacktestPosition(position: BacktestPosition, marketData: MarketData, reason: string): void {
    const exitPrice = this.calculateExitPrice(marketData, position.trade.side);
    const realizedPnl = position.unrealizedPnl;
    const fees = this.calculateFees(position.trade.size, exitPrice, true); // Assume maker exit
    const rebates = this.calculateRebates(position.trade.size, exitPrice);
    const netPnl = realizedPnl.plus(rebates).minus(fees);

    // Complete the trade
    position.trade.exitTime = marketData.timestamp;
    position.trade.exitPrice = exitPrice;
    position.trade.duration = marketData.timestamp - position.trade.entryTime;
    position.trade.pnl = realizedPnl;
    position.trade.pnlPercent = realizedPnl
      .dividedBy(position.entryPrice.multipliedBy(position.trade.size))
      .multipliedBy(100);
    position.trade.netPnl = netPnl;

    // Update portfolio
    const tradeValue = position.trade.size.multipliedBy(exitPrice);
    this.portfolio.cash = this.portfolio.cash.plus(tradeValue).plus(netPnl);
    this.portfolio.positions.delete(marketData.symbol);

    // Add to trade history
    this.trades.push(position.trade);

    logger.debug('Backtest position closed', {
      symbol: marketData.symbol,
      duration: position.trade.duration,
      pnl: realizedPnl.toNumber(),
      pnlPercent: position.trade.pnlPercent.toNumber(),
      reason,
    });
  }

  /**
   * Calculate exit price
   */
  private calculateExitPrice(marketData: MarketData, originalSide: OrderSide): Decimal {
    // For exit, we use opposite side logic
    if (originalSide === OrderSide.BUY) {
      // Selling - quote above best ask
      return marketData.ask.plus(marketData.spread.multipliedBy(0.1));
    } else {
      // Buying to cover - quote below best bid
      return marketData.bid.minus(marketData.spread.multipliedBy(0.1));
    }
  }

  /**
   * Update portfolio value
   */
  private updatePortfolioValue(marketData: MarketData): void {
    let totalUnrealizedPnl = new Decimal(0);
    
    this.portfolio.positions.forEach(position => {
      if (position.trade.symbol === marketData.symbol) {
        position.currentPrice = marketData.price;
        const priceDiff = position.trade.side === OrderSide.BUY
          ? marketData.price.minus(position.entryPrice)
          : position.entryPrice.minus(marketData.price);
        position.unrealizedPnl = priceDiff.multipliedBy(position.trade.size);
      }
      totalUnrealizedPnl = totalUnrealizedPnl.plus(position.unrealizedPnl);
    });

    this.portfolio.totalValue = this.portfolio.cash.plus(totalUnrealizedPnl);
    this.equityCurve.push(this.portfolio.totalValue);
  }

  /**
   * Check if we should trade based on signal
   */
  private shouldTrade(signal: Signal): boolean {
    // Check signal confidence
    if (signal.confidence.lessThan(0.7)) return false;

    // Check maximum positions
    if (this.portfolio.positions.size >= this.config.maxPositions) return false;

    // Check if we already have a position in this symbol
    if (this.portfolio.positions.has(signal.symbol)) return false;

    return true;
  }

  /**
   * Record daily return
   */
  private recordDailyReturn(): void {
    if (this.equityCurve.length < 2) return;

    const currentValue = this.equityCurve[this.equityCurve.length - 1];
    const previousValue = this.equityCurve[this.equityCurve.length - 2];
    
    const dailyReturn = currentValue.minus(previousValue).dividedBy(previousValue);
    this.dailyReturns.push(dailyReturn);
  }

  /**
   * Check if we should record daily return
   */
  private shouldRecordDailyReturn(timestamp: number): boolean {
    // Simplified - in reality would check if it's a new day
    return this.equityCurve.length % 100 === 0; // Record every 100 data points
  }

  /**
   * Reset portfolio for new backtest
   */
  private resetPortfolio(): void {
    this.portfolio = {
      cash: this.config.initialCapital,
      totalValue: this.config.initialCapital,
      positions: new Map(),
      openOrders: new Map(),
    };
    this.trades = [];
    this.dailyReturns = [];
    this.equityCurve = [this.config.initialCapital];
  }

  /**
   * Generate backtest result
   */
  private generateBacktestResult(startDate: number, endDate: number): BacktestResult {
    const finalCapital = this.portfolio.totalValue;
    const totalReturn = finalCapital.minus(this.config.initialCapital)
      .dividedBy(this.config.initialCapital)
      .multipliedBy(100);

    const durationDays = (endDate - startDate) / (1000 * 60 * 60 * 24);
    const annualizedReturn = totalReturn.multipliedBy(365).dividedBy(durationDays);

    const metrics = this.calculatePerformanceMetrics();
    const { maxDrawdown } = MathUtils.calculateMaxDrawdown(this.equityCurve);
    const sharpeRatio = MathUtils.calculateSharpeRatio(this.dailyReturns);

    const winningTrades = this.trades.filter(trade => trade.netPnl.greaterThan(0));
    const winRate = this.trades.length > 0 
      ? new Decimal(winningTrades.length).dividedBy(this.trades.length).multipliedBy(100)
      : new Decimal(0);

    return {
      startDate,
      endDate,
      initialCapital: this.config.initialCapital,
      finalCapital,
      totalReturn,
      annualizedReturn,
      maxDrawdown,
      sharpeRatio,
      winRate,
      totalTrades: this.trades.length,
      avgTradeReturn: this.trades.length > 0 
        ? this.trades.reduce((sum, trade) => sum.plus(trade.pnlPercent), new Decimal(0))
            .dividedBy(this.trades.length)
        : new Decimal(0),
      profitFactor: metrics.profitFactor,
      trades: [...this.trades],
      dailyReturns: [...this.dailyReturns],
      equity: [...this.equityCurve],
      metrics,
    };
  }

  /**
   * Calculate performance metrics
   */
  private calculatePerformanceMetrics(): PerformanceMetrics {
    const winningTrades = this.trades.filter(trade => trade.netPnl.greaterThan(0));
    const losingTrades = this.trades.filter(trade => trade.netPnl.lessThan(0));

    const totalWins = winningTrades.reduce((sum, trade) => sum.plus(trade.netPnl), new Decimal(0));
    const totalLosses = losingTrades.reduce((sum, trade) => sum.plus(trade.netPnl.abs()), new Decimal(0));

    const avgWin = winningTrades.length > 0 
      ? totalWins.dividedBy(winningTrades.length) 
      : new Decimal(0);
    
    const avgLoss = losingTrades.length > 0 
      ? totalLosses.dividedBy(losingTrades.length) 
      : new Decimal(0);

    const profitFactor = totalLosses.greaterThan(0) 
      ? totalWins.dividedBy(totalLosses) 
      : new Decimal(0);

    const largestWin = winningTrades.length > 0 
      ? winningTrades.reduce((max, trade) => 
          trade.netPnl.greaterThan(max) ? trade.netPnl : max, new Decimal(0))
      : new Decimal(0);

    const largestLoss = losingTrades.length > 0 
      ? losingTrades.reduce((max, trade) => 
          trade.netPnl.abs().greaterThan(max) ? trade.netPnl.abs() : max, new Decimal(0))
      : new Decimal(0);

    const totalFees = this.trades.reduce((sum, trade) => sum.plus(trade.fees), new Decimal(0));
    const totalRebates = this.trades.reduce((sum, trade) => sum.plus(trade.rebates), new Decimal(0));
    const netReturn = totalWins.minus(totalLosses).plus(totalRebates).minus(totalFees);

    return {
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: this.trades.length > 0 ? new Decimal(winningTrades.length).dividedBy(this.trades.length) : new Decimal(0),
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      profitFactor,
      sharpeRatio: MathUtils.calculateSharpeRatio(this.dailyReturns),
      sortinoRatio: new Decimal(0), // Simplified
      calmarRatio: new Decimal(0), // Simplified
      maxDrawdown: MathUtils.calculateMaxDrawdown(this.equityCurve).maxDrawdown,
      maxDrawdownDuration: 0, // Simplified
      volatility: this.dailyReturns.length > 0 
        ? this.calculateVolatility(this.dailyReturns) 
        : new Decimal(0),
      totalReturn: netReturn.dividedBy(this.config.initialCapital).multipliedBy(100),
      annualizedReturn: new Decimal(0), // Calculated in main result
      totalFees,
      totalRebates,
      netReturn,
    };
  }

  /**
   * Calculate volatility
   */
  private calculateVolatility(returns: Decimal[]): Decimal {
    if (returns.length === 0) return new Decimal(0);

    const mean = returns.reduce((sum, ret) => sum.plus(ret), new Decimal(0)).dividedBy(returns.length);
    const variance = returns.reduce((sum, ret) => {
      return sum.plus(ret.minus(mean).pow(2));
    }, new Decimal(0)).dividedBy(returns.length);

    return variance.sqrt().multipliedBy(Math.sqrt(252)); // Annualized
  }
}

interface BacktestPortfolio {
  cash: Decimal;
  totalValue: Decimal;
  positions: Map<string, BacktestPosition>;
  openOrders: Map<string, any>;
}

interface BacktestPosition {
  trade: TradeAnalysis;
  entryPrice: Decimal;
  currentPrice: Decimal;
  unrealizedPnl: Decimal;
}
