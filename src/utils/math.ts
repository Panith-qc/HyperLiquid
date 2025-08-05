import { Decimal } from 'decimal.js';

// Configure Decimal.js for financial precision
Decimal.config({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -15,
  toExpPos: 20,
});

export class MathUtils {
  /**
   * Calculate percentage change between two values
   */
  static percentageChange(oldValue: Decimal, newValue: Decimal): Decimal {
    if (oldValue.isZero()) return new Decimal(0);
    return newValue.minus(oldValue).dividedBy(oldValue).multipliedBy(100);
  }

  /**
   * Calculate moving average
   */
  static movingAverage(values: Decimal[], period: number): Decimal[] {
    const result: Decimal[] = [];
    for (let i = period - 1; i < values.length; i++) {
      const sum = values.slice(i - period + 1, i + 1)
        .reduce((acc, val) => acc.plus(val), new Decimal(0));
      result.push(sum.dividedBy(period));
    }
    return result;
  }

  /**
   * Calculate exponential moving average
   */
  static exponentialMovingAverage(values: Decimal[], period: number): Decimal[] {
    const result: Decimal[] = [];
    const multiplier = new Decimal(2).dividedBy(period + 1);
    
    let ema = values[0];
    result.push(ema);
    
    for (let i = 1; i < values.length; i++) {
      ema = values[i].multipliedBy(multiplier).plus(ema.multipliedBy(new Decimal(1).minus(multiplier)));
      result.push(ema);
    }
    
    return result;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  static calculateRSI(prices: Decimal[], period: number = 14): Decimal[] {
    const gains: Decimal[] = [];
    const losses: Decimal[] = [];
    
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i].minus(prices[i - 1]);
      gains.push(change.greaterThan(0) ? change : new Decimal(0));
      losses.push(change.lessThan(0) ? change.abs() : new Decimal(0));
    }
    
    const avgGains = this.movingAverage(gains, period);
    const avgLosses = this.movingAverage(losses, period);
    
    const rsi: Decimal[] = [];
    for (let i = 0; i < avgGains.length; i++) {
      if (avgLosses[i].isZero()) {
        rsi.push(new Decimal(100));
      } else {
        const rs = avgGains[i].dividedBy(avgLosses[i]);
        rsi.push(new Decimal(100).minus(new Decimal(100).dividedBy(rs.plus(1))));
      }
    }
    
    return rsi;
  }

  /**
   * Calculate Bollinger Bands
   */
  static calculateBollingerBands(prices: Decimal[], period: number = 20, stdDev: number = 2): {
    middle: Decimal[];
    upper: Decimal[];
    lower: Decimal[];
  } {
    const middle = this.movingAverage(prices, period);
    const upper: Decimal[] = [];
    const lower: Decimal[] = [];
    
    for (let i = period - 1; i < prices.length; i++) {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = middle[i - period + 1];
      const variance = slice.reduce((acc, val) => {
        return acc.plus(val.minus(mean).pow(2));
      }, new Decimal(0)).dividedBy(period);
      const standardDeviation = variance.sqrt();
      
      upper.push(mean.plus(standardDeviation.multipliedBy(stdDev)));
      lower.push(mean.minus(standardDeviation.multipliedBy(stdDev)));
    }
    
    return { middle, upper, lower };
  }

  /**
   * Calculate Sharpe Ratio
   */
  static calculateSharpeRatio(returns: Decimal[], riskFreeRate: Decimal = new Decimal(0)): Decimal {
    if (returns.length === 0) return new Decimal(0);
    
    const meanReturn = returns.reduce((acc, val) => acc.plus(val), new Decimal(0))
      .dividedBy(returns.length);
    
    const excessReturn = meanReturn.minus(riskFreeRate.dividedBy(252)); // Daily risk-free rate
    
    const variance = returns.reduce((acc, val) => {
      return acc.plus(val.minus(meanReturn).pow(2));
    }, new Decimal(0)).dividedBy(returns.length - 1);
    
    const standardDeviation = variance.sqrt();
    
    if (standardDeviation.isZero()) return new Decimal(0);
    
    return excessReturn.dividedBy(standardDeviation).multipliedBy(Math.sqrt(252)); // Annualized
  }

  /**
   * Calculate maximum drawdown
   */
  static calculateMaxDrawdown(equity: Decimal[]): { maxDrawdown: Decimal; maxDrawdownPercent: Decimal } {
    let maxDrawdown = new Decimal(0);
    let maxDrawdownPercent = new Decimal(0);
    let peak = equity[0];
    
    for (const value of equity) {
      if (value.greaterThan(peak)) {
        peak = value;
      }
      
      const drawdown = peak.minus(value);
      const drawdownPercent = peak.isZero() ? new Decimal(0) : drawdown.dividedBy(peak).multipliedBy(100);
      
      if (drawdown.greaterThan(maxDrawdown)) {
        maxDrawdown = drawdown;
      }
      
      if (drawdownPercent.greaterThan(maxDrawdownPercent)) {
        maxDrawdownPercent = drawdownPercent;
      }
    }
    
    return { maxDrawdown, maxDrawdownPercent };
  }

  /**
   * Round to tick size
   */
  static roundToTickSize(price: Decimal, tickSize: Decimal): Decimal {
    return price.dividedBy(tickSize).round().multipliedBy(tickSize);
  }

  /**
   * Calculate position size based on risk
   */
  static calculatePositionSize(
    accountBalance: Decimal,
    riskPercent: Decimal,
    entryPrice: Decimal,
    stopPrice: Decimal
  ): Decimal {
    const riskAmount = accountBalance.multipliedBy(riskPercent.dividedBy(100));
    const priceRisk = entryPrice.minus(stopPrice).abs();
    
    if (priceRisk.isZero()) return new Decimal(0);
    
    return riskAmount.dividedBy(priceRisk);
  }
}
