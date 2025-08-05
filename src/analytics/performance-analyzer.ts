import { Decimal } from 'decimal.js';
import { logger } from '@/utils/logger';
import { MathUtils } from '@/utils/math';
import { TradeAnalysis, PerformanceMetrics } from '@/types';

export class PerformanceAnalyzer {
  /**
   * Analyze trading performance from trade history
   */
  static analyzePerformance(trades: TradeAnalysis[]): PerformanceMetrics {
    if (trades.length === 0) {
      return this.getEmptyMetrics();
    }

    const winningTrades = trades.filter(trade => trade.netPnl.greaterThan(0));
    const losingTrades = trades.filter(trade => trade.netPnl.lessThan(0));

    // Basic metrics
    const winRate = new Decimal(winningTrades.length).dividedBy(trades.length);
    const avgWin = winningTrades.length > 0 
      ? winningTrades.reduce((sum, trade) => sum.plus(trade.netPnl), new Decimal(0))
          .dividedBy(winningTrades.length)
      : new Decimal(0);
    
    const avgLoss = losingTrades.length > 0 
      ? losingTrades.reduce((sum, trade) => sum.plus(trade.netPnl.abs()), new Decimal(0))
          .dividedBy(losingTrades.length)
      : new Decimal(0);

    // Profit factor
    const grossProfit = winningTrades.reduce((sum, trade) => sum.plus(trade.netPnl), new Decimal(0));
    const grossLoss = losingTrades.reduce((sum, trade) => sum.plus(trade.netPnl.abs()), new Decimal(0));
    const profitFactor = grossLoss.greaterThan(0) ? grossProfit.dividedBy(grossLoss) : new Decimal(0);

    // Largest wins/losses
    const largestWin = winningTrades.length > 0 
      ? winningTrades.reduce((max, trade) => 
          trade.netPnl.greaterThan(max) ? trade.netPnl : max, new Decimal(0))
      : new Decimal(0);

    const largestLoss = losingTrades.length > 0 
      ? losingTrades.reduce((max, trade) => 
          trade.netPnl.abs().greaterThan(max) ? trade.netPnl.abs() : max, new Decimal(0))
      : new Decimal(0);

    // Risk metrics
    const returns = trades.map(trade => trade.pnlPercent.dividedBy(100));
    const sharpeRatio = MathUtils.calculateSharpeRatio(returns);
    
    // Calculate equity curve for drawdown analysis
    const equityCurve = this.calculateEquityCurve(trades, new Decimal(10000));
    const { maxDrawdown, maxDrawdownPercent } = MathUtils.calculateMaxDrawdown(equityCurve);

    // Sum totals
    const totalFees = trades.reduce((sum, trade) => sum.plus(trade.fees), new Decimal(0));
    const totalRebates = trades.reduce((sum, trade) => sum.plus(trade.rebates), new Decimal(0));
    const totalReturn = grossProfit.minus(grossLoss).plus(totalRebates).minus(totalFees);

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      profitFactor,
      sharpeRatio,
      sortinoRatio: this.calculateSortinoRatio(returns),
      calmarRatio: this.calculateCalmarRatio(totalReturn, maxDrawdownPercent),
      maxDrawdown,
      maxDrawdownDuration: this.calculateMaxDrawdownDuration(equityCurve),
      volatility: this.calculateVolatility(returns),
      totalReturn: totalReturn.dividedBy(new Decimal(10000)).multipliedBy(100), // Assuming $10k initial
      annualizedReturn: this.calculateAnnualizedReturn(totalReturn, trades),
      totalFees,
      totalRebates,
      netReturn: totalReturn,
    };
  }

  /**
   * Calculate Sortino ratio
   */
  private static calculateSortinoRatio(returns: Decimal[]): Decimal {
    if (returns.length === 0) return new Decimal(0);

    const meanReturn = returns.reduce((sum, ret) => sum.plus(ret), new Decimal(0)).dividedBy(returns.length);
    const downSideDeviations = returns
      .filter(ret => ret.lessThan(0))
      .map(ret => ret.pow(2));

    if (downSideDeviations.length === 0) return new Decimal(0);

    const downSideVariance = downSideDeviations
      .reduce((sum, dev) => sum.plus(dev), new Decimal(0))
      .dividedBy(downSideDeviations.length);
    
    const downSideDeviation = downSideVariance.sqrt();
    
    return downSideDeviation.greaterThan(0) 
      ? meanReturn.dividedBy(downSideDeviation).multipliedBy(Math.sqrt(252))
      : new Decimal(0);
  }

  /**
   * Calculate Calmar ratio
   */
  private static calculateCalmarRatio(totalReturn: Decimal, maxDrawdown: Decimal): Decimal {
    if (maxDrawdown.isZero()) return new Decimal(0);
    return totalReturn.dividedBy(maxDrawdown);
  }

  /**
   * Calculate equity curve
   */
  private static calculateEquityCurve(trades: TradeAnalysis[], initialCapital: Decimal): Decimal[] {
    const equity = [initialCapital];
    let current = initialCapital;

    trades.forEach(trade => {
      current = current.plus(trade.netPnl);
      equity.push(current);
    });

    return equity;
  }

  /**
   * Calculate maximum drawdown duration
   */
  private static calculateMaxDrawdownDuration(equityCurve: Decimal[]): number {
    let maxDuration = 0;
    let currentDuration = 0;
    let peak = equityCurve[0];

    for (let i = 1; i < equityCurve.length; i++) {
      if (equityCurve[i].greaterThan(peak)) {
        peak = equityCurve[i];
        currentDuration = 0;
      } else {
        currentDuration++;
        maxDuration = Math.max(maxDuration, currentDuration);
      }
    }

    return maxDuration;
  }

  /**
   * Calculate volatility
   */
  private static calculateVolatility(returns: Decimal[]): Decimal {
    if (returns.length === 0) return new Decimal(0);

    const mean = returns.reduce((sum, ret) => sum.plus(ret), new Decimal(0)).dividedBy(returns.length);
    const variance = returns.reduce((sum, ret) => {
      return sum.plus(ret.minus(mean).pow(2));
    }, new Decimal(0)).dividedBy(returns.length);

    return variance.sqrt().multipliedBy(Math.sqrt(252)); // Annualized
  }

  /**
   * Calculate annualized return
   */
  private static calculateAnnualizedReturn(totalReturn: Decimal, trades: TradeAnalysis[]): Decimal {
    if (trades.length === 0) return new Decimal(0);

    const firstTrade = trades[0];
    const lastTrade = trades[trades.length - 1];
    const durationDays = (lastTrade.exitTime - firstTrade.entryTime) / (1000 * 60 * 60 * 24);
    
    if (durationDays <= 0) return new Decimal(0);

    return totalReturn.multipliedBy(365).dividedBy(durationDays);
  }

  /**
   * Get empty metrics
   */
  private static getEmptyMetrics(): PerformanceMetrics {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: new Decimal(0),
      avgWin: new Decimal(0),
      avgLoss: new Decimal(0),
      largestWin: new Decimal(0),
      largestLoss: new Decimal(0),
      profitFactor: new Decimal(0),
      sharpeRatio: new Decimal(0),
      sortinoRatio: new Decimal(0),
      calmarRatio: new Decimal(0),
      maxDrawdown: new Decimal(0),
      maxDrawdownDuration: 0,
      volatility: new Decimal(0),
      totalReturn: new Decimal(0),
      annualizedReturn: new Decimal(0),
      totalFees: new Decimal(0),
      totalRebates: new Decimal(0),
      netReturn: new Decimal(0),
    };
  }

  /**
   * Generate performance report
   */
  static generateReport(metrics: PerformanceMetrics): string {
    return `
PERFORMANCE ANALYSIS REPORT
===========================

TRADE STATISTICS:
- Total Trades: ${metrics.totalTrades}
- Winning Trades: ${metrics.winningTrades}
- Losing Trades: ${metrics.losingTrades}
- Win Rate: ${metrics.winRate.multipliedBy(100).toFixed(2)}%

PROFIT & LOSS:
- Total Return: ${metrics.totalReturn.toFixed(2)}%
- Annualized Return: ${metrics.annualizedReturn.toFixed(2)}%
- Net Return: $${metrics.netReturn.toFixed(2)}
- Average Win: $${metrics.avgWin.toFixed(2)}
- Average Loss: $${metrics.avgLoss.toFixed(2)}
- Largest Win: $${metrics.largestWin.toFixed(2)}
- Largest Loss: $${metrics.largestLoss.toFixed(2)}
- Profit Factor: ${metrics.profitFactor.toFixed(2)}

RISK METRICS:
- Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}
- Sortino Ratio: ${metrics.sortinoRatio.toFixed(2)}
- Calmar Ratio: ${metrics.calmarRatio.toFixed(2)}
- Maximum Drawdown: ${metrics.maxDrawdown.toFixed(2)}%
- Max Drawdown Duration: ${metrics.maxDrawdownDuration} periods
- Volatility: ${metrics.volatility.multipliedBy(100).toFixed(2)}%

COSTS:
- Total Fees: $${metrics.totalFees.toFixed(2)}
- Total Rebates: $${metrics.totalRebates.toFixed(2)}
- Net Cost: $${metrics.totalFees.minus(metrics.totalRebates).toFixed(2)}
    `.trim();
  }
}

// === src/monitoring/dashboard.ts ===
import express from 'express';
import { Server } from 'http';
import { logger } from '@/utils/logger';
import { RiskManager } from '@/core/risk-manager';
import { OneSidedQuotingStrategy } from '@/strategies/one-sided-quoting';
import { PerformanceAnalyzer } from '@/analytics/performance-analyzer';
import path from 'path';

export interface DashboardConfig {
  port: number;
  refreshInterval: number;
  enableAuth: boolean;
  authToken?: string;
}

export class Dashboard {
  private app: express.Application;
  private server: Server | null = null;
  private config: DashboardConfig;
  private riskManager: RiskManager;
  private strategy: OneSidedQuotingStrategy;
  private dashboardData: any = {};

  constructor(
    config: DashboardConfig,
    riskManager: RiskManager,
    strategy: OneSidedQuotingStrategy
  ) {
    this.config = config;
    this.riskManager = riskManager;
    this.strategy = strategy;
    this.app = express();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.startDataCollection();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'static')));
    
    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });

    // Authentication middleware
    if (this.config.enableAuth) {
      this.app.use('/api', (req, res, next) => {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token !== this.config.authToken) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
      });
    }
  }

  private setupRoutes(): void {
    // Main dashboard page
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'static', 'dashboard.html'));
    });

    // API endpoints
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'running',
        timestamp: Date.now(),
        uptime: process.uptime(),
        strategy: {
          isRunning: this.strategy.getStatistics().isRunning,
          activeOrders: this.strategy.getStatistics().activeOrders,
        },
        risk: this.riskManager.getRiskSummary(),
      });
    });

    this.app.get('/api/metrics', (req, res) => {
      res.json(this.dashboardData);
    });

    this.app.get('/api/risk', (req, res) => {
      res.json({
        metrics: this.riskManager.getRiskMetrics(),
        limits: this.riskManager.getRiskLimits(),
        portfolio: this.riskManager.getPortfolio(),
        positions: this.riskManager.getAllPositions(),
      });
    });

    this.app.get('/api/performance', (req, res) => {
      const trades = []; // Would get from trade history
      const performance = PerformanceAnalyzer.analyzePerformance(trades);
      res.json(performance);
    });

    this.app.post('/api/emergency-stop', (req, res) => {
      try {
        if (req.body.action === 'trigger') {
          this.riskManager.triggerEmergencyStop();
          res.json({ success: true, message: 'Emergency stop triggered' });
        } else if (req.body.action === 'reset') {
          this.riskManager.resetEmergencyStop();
          res.json({ success: true, message: 'Emergency stop reset' });
        } else {
          res.status(400).json({ error: 'Invalid action' });
        }
      } catch (error) {
        res.status(500).json({ error: 'Failed to execute emergency stop action' });
      }
    });

    this.app.post('/api/strategy/toggle', (req, res) => {
      try {
        const { action } = req.body;
        if (action === 'start') {
          this.strategy.start();
        } else if (action === 'stop') {
          this.strategy.stop();
        }
        res.json({ success: true, action });
      } catch (error) {
        res.status(500).json({ error: 'Failed to toggle strategy' });
      }
    });
  }

  /**
   * Start data collection for dashboard
   */
  private startDataCollection(): void {
    setInterval(() => {
      this.updateDashboardData();
    }, this.config.refreshInterval);
  }

  /**
   * Update dashboard data
   */
  private updateDashboardData(): void {
    try {
      this.dashboardData = {
        timestamp: Date.now(),
        strategy: this.strategy.getStatistics(),
        risk: this.riskManager.getRiskSummary(),
        portfolio: this.riskManager.getPortfolio(),
        positions: this.riskManager.getAllPositions(),
        systemHealth: this.getSystemHealth(),
      };
    } catch (error) {
      logger.error('Error updating dashboard data', error);
    }
  }

  /**
   * Get system health metrics
   */
  private getSystemHealth(): any {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      uptime: process.uptime(),
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Start dashboard server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.config.port, () => {
        logger.info(`Dashboard server started on port ${this.config.port}`);
        logger.info(`Dashboard URL: http://localhost:${this.config.port}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop dashboard server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          logger.info('Dashboard server stopped');
          resolve();
        });
      });
    }
  }
}
