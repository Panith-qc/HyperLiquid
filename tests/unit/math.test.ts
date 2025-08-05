import { MathUtils } from '../../src/utils/math';
import { Decimal } from 'decimal.js';

describe('MathUtils', () => {
  describe('percentageChange', () => {
    it('should calculate percentage change correctly', () => {
      const result = MathUtils.percentageChange(new Decimal(100), new Decimal(110));
      expect(result.toNumber()).toBe(10);
    });

    it('should handle zero old value', () => {
      const result = MathUtils.percentageChange(new Decimal(0), new Decimal(100));
      expect(result.toNumber()).toBe(0);
    });

    it('should handle negative changes', () => {
      const result = MathUtils.percentageChange(new Decimal(100), new Decimal(90));
      expect(result.toNumber()).toBe(-10);
    });
  });

  describe('movingAverage', () => {
    it('should calculate moving average correctly', () => {
      const values = [1, 2, 3, 4, 5].map(v => new Decimal(v));
      const ma = MathUtils.movingAverage(values, 3);
      
      expect(ma.length).toBe(3);
      expect(ma[0].toNumber()).toBe(2); // (1+2+3)/3
      expect(ma[1].toNumber()).toBe(3); // (2+3+4)/3
      expect(ma[2].toNumber()).toBe(4); // (3+4+5)/3
    });
  });

  describe('calculateRSI', () => {
    it('should calculate RSI correctly', () => {
      const prices = Array.from({length: 20}, (_, i) => new Decimal(100 + i));
      const rsi = MathUtils.calculateRSI(prices, 14);
      
      expect(rsi.length).toBeGreaterThan(0);
      rsi.forEach(value => {
        expect(value.greaterThanOrEqualTo(0)).toBe(true);
        expect(value.lessThanOrEqualTo(100)).toBe(true);
      });
    });
  });

  describe('calculateSharpeRatio', () => {
    it('should calculate Sharpe ratio correctly', () => {
      const returns = [0.01, -0.005, 0.02, 0.015, -0.01].map(r => new Decimal(r));
      const sharpe = MathUtils.calculateSharpeRatio(returns);
      
      expect(sharpe.isFinite()).toBe(true);
    });

    it('should handle empty returns array', () => {
      const sharpe = MathUtils.calculateSharpeRatio([]);
      expect(sharpe.toNumber()).toBe(0);
    });
  });

  describe('roundToTickSize', () => {
    it('should round to tick size correctly', () => {
      const price = new Decimal(2000.123);
      const tickSize = new Decimal(0.01);
      const rounded = MathUtils.roundToTickSize(price, tickSize);
      
      expect(rounded.toNumber()).toBe(2000.12);
    });
  });
});
