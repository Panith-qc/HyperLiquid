import { Decimal } from 'decimal.js';

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: Decimal;
  avgWin: Decimal;
  avgLoss: Decimal;
  largestWin: Decimal;
  largestLoss: Decimal;
  profitFactor: Decimal;
  sharpeRatio: Decimal;
  sortinoRatio: Decimal;
  calmarRatio: Decimal;
  maxDrawdown: Decimal;
  maxDrawdownDuration: number;
  volatility: Decimal;
  totalReturn: Decimal;
  annualizedReturn: Decimal;
  totalFees: Decimal;
  totalRebates: Decimal;
  netReturn: Decimal;
}

export interface TradeAnalysis {
  id: string;
  symbol: string;
  entryTime: number;
  exitTime: number;
  duration: number;
  side: OrderSide;
  entryPrice: Decimal;
  exitPrice: Decimal;
  size: Decimal;
  pnl: Decimal;
  pnlPercent: Decimal;
  fees: Decimal;
  rebates: Decimal;
  netPnl: Decimal;
  reason: string;
  signalStrength: Decimal;
  maxFavorableExcursion: Decimal;
  maxAdverseExcursion: Decimal;
}

export interface BacktestResult {
  startDate: number;
  endDate: number;
  initialCapital: Decimal;
  finalCapital: Decimal;
  totalReturn: Decimal;
  annualizedReturn: Decimal;
  maxDrawdown: Decimal;
  sharpeRatio: Decimal;
  winRate: Decimal;
  totalTrades: number;
  avgTradeReturn: Decimal;
  profitFactor: Decimal;
  trades: TradeAnalysis[];
  dailyReturns: Decimal[];
  equity: Decimal[];
  metrics: PerformanceMetrics;
}