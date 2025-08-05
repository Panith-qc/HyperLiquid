import { Decimal } from 'decimal.js';

export interface RiskMetrics {
  totalExposure: Decimal;
  maxPositionSize: Decimal;
  currentDrawdown: Decimal;
  maxDrawdown: Decimal;
  dailyPnl: Decimal;
  dailyLoss: Decimal;
  sharpeRatio: Decimal;
  winRate: Decimal;
  avgWin: Decimal;
  avgLoss: Decimal;
  profitFactor: Decimal;
}

export interface RiskLimits {
  maxPositionSize: Decimal;
  maxDailyLoss: Decimal;
  maxDrawdownPercent: Decimal;
  maxOpenPositions: number;
  positionTimeoutMinutes: number;
  emergencyStopLossPercent: Decimal;
  concentrationLimit: Decimal;
}

export interface RiskAlert {
  id: string;
  timestamp: number;
  level: 'WARNING' | 'CRITICAL' | 'EMERGENCY';
  type: string;
  message: string;
  symbol?: string;
  value: Decimal;
  limit: Decimal;
  action: string;
}

export interface Portfolio {
  totalValue: Decimal;
  cash: Decimal;
  positions: Position[];
  unrealizedPnl: Decimal;
  realizedPnl: Decimal;
  totalFees: Decimal;
  totalRebates: Decimal;
  netPnl: Decimal;
}