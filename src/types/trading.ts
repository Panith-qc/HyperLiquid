import { Decimal } from 'decimal.js';

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP = 'stop',
  STOP_LIMIT = 'stop_limit'
}

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

export enum OrderStatus {
  PENDING = 'pending',
  OPEN = 'open',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
  EXPIRED = 'expired'
}

export enum Direction {
  LONG = 'LONG',
  SHORT = 'SHORT',
  NEUTRAL = 'NEUTRAL'
}

export interface Order {
  id: string;
  clientOrderId: string;
  symbol: string;
  type: OrderType;
  side: OrderSide;
  amount: Decimal;
  price?: Decimal;
  stopPrice?: Decimal;
  status: OrderStatus;
  filled: Decimal;
  remaining: Decimal;
  timestamp: number;
  updatedAt: number;
  fees: Decimal;
  rebates: Decimal;
  maker: boolean;
}

export interface Position {
  symbol: string;
  side: OrderSide;
  size: Decimal;
  entryPrice: Decimal;
  markPrice: Decimal;
  unrealizedPnl: Decimal;
  realizedPnl: Decimal;
  timestamp: number;
  fees: Decimal;
  rebates: Decimal;
}

export interface Signal {
  timestamp: number;
  symbol: string;
  direction: Direction;
  confidence: Decimal;
  strength: Decimal;
  reason: string;
  indicators: Record<string, Decimal>;
  metadata: Record<string, any>;
}