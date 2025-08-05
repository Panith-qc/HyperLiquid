import { Decimal } from 'decimal.js';

export interface MarketData {
  symbol: string;
  timestamp: number;
  price: Decimal;
  bid: Decimal;
  ask: Decimal;
  bidSize: Decimal;
  askSize: Decimal;
  volume24h: Decimal;
  change24h: Decimal;
  spread: Decimal;
  midPrice: Decimal;
}

export interface OrderBookLevel {
  price: Decimal;
  size: Decimal;
  orders: number;
}

export interface OrderBook {
  symbol: string;
  timestamp: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  sequence: number;
}

export interface Trade {
  id: string;
  symbol: string;
  timestamp: number;
  price: Decimal;
  size: Decimal;
  side: 'buy' | 'sell';
  maker: boolean;
}