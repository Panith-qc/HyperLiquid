import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { logger } from '@/utils/logger';
import { MathUtils } from '@/utils/math';
import { 
  MarketData, 
  OrderBook, 
  Trade, 
  Signal, 
  Direction, 
  VolumeProfile, 
  TechnicalIndicators 
} from '@/types';

export interface SignalConfig {
  momentumPeriods: number[];
  volumeThreshold: number;
  rsiPeriod: number;
  emaPeriods: number[];
  bollingerPeriod: number;
  bollingerStdDev: number;
  signalSmoothing: number;
  minConfidence: number;
}

export class SignalGenerator extends EventEmitter {
  private config: SignalConfig;
  private priceHistory: Map<string, Decimal[]> = new Map();
  private volumeHistory: Map<string, Decimal[]> = new Map();
  private tradeHistory: Map<string, Trade[]> = new Map();
  private indicators: Map<string, TechnicalIndicators> = new Map();
  private lastSignals: Map<string, Signal> = new Map();
  private maxHistoryLength = 1000;

  constructor(config: SignalConfig) {
    super();
    this.config = {
      momentumPeriods: [5, 15, 30],
      volumeThreshold: 1.5,
      rsiPeriod: 14,
      emaPeriods: [20, 50],
      bollingerPeriod: 20,
      bollingerStdDev: 2,
      signalSmoothing: 0.3,
      minConfidence: 0.6,
      ...config,
    };
  }

  /**
   * Process new market data and generate signals
   */
  processMarketData(marketData: MarketData): void {
    try {
      this.updatePriceHistory(marketData);
      this.updateVolumeHistory(marketData);
      
      const signal = this.generateSignal(marketData.symbol);
      if (signal && signal.confidence.greaterThanOrEqualTo(this.config.minConfidence)) {
        this.lastSignals.set(marketData.symbol, signal);
        this.emit('signal', signal);
        
        logger.debug('Signal generated', {
          symbol: signal.symbol,
          direction: signal.direction,
          confidence: signal.confidence.toNumber(),
          strength: signal.strength.toNumber(),
          reason: signal.reason,
        });
      }
    } catch (error) {
      logger.error('Error processing market data for signals', { error, symbol: marketData.symbol });
    }
  }

  /**
   * Process new trades for signal generation
   */
  processTrade(trade: Trade): void {
    const trades = this.tradeHistory.get(trade.symbol) || [];
    trades.push(trade);
    
    // Keep only recent trades
    if (trades.length > this.maxHistoryLength) {
      trades.splice(0, trades.length - this.maxHistoryLength);
    }
    
    this.tradeHistory.set(trade.symbol, trades);
  }

  /**
   * Generate trading signal for a symbol
   */
  private generateSignal(symbol: string): Signal | null {
    try {
      const prices = this.priceHistory.get(symbol);
      const volumes = this.volumeHistory.get(symbol);
      
      if (!prices || prices.length < 50) {
        return null; // Need sufficient history
      }

      // Calculate technical indicators
      const indicators = this.calculateTechnicalIndicators(symbol, prices);
      this.indicators.set(symbol, indicators);

      // Calculate momentum signals
      const momentumSignal = this.calculateMomentumSignal(prices);
      
      // Calculate volume profile signal
      const volumeSignal = this.calculateVolumeSignal(symbol);
      
      // Calculate technical indicator signals
      const rsiSignal = this.calculateRSISignal(indicators.rsi);
      const emaSignal = this.calculateEMASignal(indicators);
      const bollingerSignal = this.calculateBollingerSignal(prices[prices.length - 1], indicators);
      
      // Calculate order flow signal
      const orderFlowSignal = this.calculateOrderFlowSignal(symbol);

      // Combine signals with weights
      const signals = [
        { signal: momentumSignal, weight: 0.30 },
        { signal: volumeSignal, weight: 0.25 },
        { signal: rsiSignal, weight: 0.15 },
        { signal: emaSignal, weight: 0.15 },
        { signal: bollingerSignal, weight: 0.10 },
        { signal: orderFlowSignal, weight: 0.05 },
      ];

      const combinedSignal = this.combineSignals(signals);
      
      // Apply signal smoothing
      const smoothedSignal = this.applySignalSmoothing(symbol, combinedSignal);

      // Generate final signal
      const signal: Signal = {
        timestamp: Date.now(),
        symbol,
        direction: smoothedSignal.direction,
        confidence: smoothedSignal.confidence,
        strength: smoothedSignal.strength,
        reason: smoothedSignal.reason,
        indicators: {
          momentum: momentumSignal.strength,
          volume: volumeSignal.strength,
          rsi: rsiSignal.strength,
          ema: emaSignal.strength,
          bollinger: bollingerSignal.strength,
          orderFlow: orderFlowSignal.strength,
        },
        metadata: {
          technicalIndicators: indicators,
          priceCount: prices.length,
          volumeCount: volumes?.length || 0,
        },
      };

      return signal;
    } catch (error) {
      logger.error('Error generating signal', { error, symbol });
      return null;
    }
  }

  /**
   * Calculate momentum-based signal
   */
  private calculateMomentumSignal(prices: Decimal[]): {
    direction: Direction;
    confidence: Decimal;
    strength: Decimal;
    reason: string;
  } {
    const momentumScores: Decimal[] = [];
    
    for (const period of this.config.momentumPeriods) {
      if (prices.length >= period) {
        const currentPrice = prices[prices.length - 1];
        const pastPrice = prices[prices.length - period];
        const momentum = MathUtils.percentageChange(pastPrice, currentPrice);
        momentumScores.push(momentum);
      }
    }

    if (momentumScores.length === 0) {
      return {
        direction: Direction.NEUTRAL,
        confidence: new Decimal(0),
        strength: new Decimal(0),
        reason: 'Insufficient data for momentum calculation',
      };
    }

    // Calculate weighted momentum (shorter periods have higher weight)
    let totalWeightedMomentum = new Decimal(0);
    let totalWeight = new Decimal(0);
    
    momentumScores.forEach((momentum, index) => {
      const weight = new Decimal(1).dividedBy(index + 1); // Higher weight for shorter periods
      totalWeightedMomentum = totalWeightedMomentum.plus(momentum.multipliedBy(weight));
      totalWeight = totalWeight.plus(weight);
    });

    const avgMomentum = totalWeightedMomentum.dividedBy(totalWeight);
    const strength = avgMomentum.abs();
    const confidence = strength.dividedBy(10).clampedTo(0, 1); // Scale to 0-1

    let direction = Direction.NEUTRAL;
    if (avgMomentum.greaterThan(0.5)) {
      direction = Direction.LONG;
    } else if (avgMomentum.lessThan(-0.5)) {
      direction = Direction.SHORT;
    }

    return {
      direction,
      confidence,
      strength,
      reason: `Momentum: ${avgMomentum.toFixed(2)}% (${this.config.momentumPeriods.join(',')}-period average)`,
    };
  }

  /**
   * Calculate volume-based signal
   */
  private calculateVolumeSignal(symbol: string): {
    direction: Direction;
    confidence: Decimal;
    strength: Decimal;
    reason: string;
  } {
    const trades = this.tradeHistory.get(symbol) || [];
    
    if (trades.length < 20) {
      return {
        direction: Direction.NEUTRAL,
        confidence: new Decimal(0),
        strength: new Decimal(0),
        reason: 'Insufficient trade data for volume analysis',
      };
    }

    // Calculate recent volume profile (last 50 trades)
    const recentTrades = trades.slice(-50);
    let buyVolume = new Decimal(0);
    let sellVolume = new Decimal(0);

    recentTrades.forEach(trade => {
      if (trade.side === 'buy') {
        buyVolume = buyVolume.plus(trade.size);
      } else {
        sellVolume = sellVolume.plus(trade.size);
      }
    });

    const totalVolume = buyVolume.plus(sellVolume);
    if (totalVolume.isZero()) {
      return {
        direction: Direction.NEUTRAL,
        confidence: new Decimal(0),
        strength: new Decimal(0),
        reason: 'No volume data available',
      };
    }

    const imbalance = buyVolume.minus(sellVolume).dividedBy(totalVolume);
    const strength = imbalance.abs();
    const confidence = strength.multipliedBy(2).clampedTo(0, 1); // Scale imbalance to confidence

    let direction = Direction.NEUTRAL;
    if (imbalance.greaterThan(this.config.volumeThreshold / 100)) {
      direction = Direction.LONG;
    } else if (imbalance.lessThan(-this.config.volumeThreshold / 100)) {
      direction = Direction.SHORT;
    }

    return {
      direction,
      confidence,
      strength,
      reason: `Volume imbalance: ${imbalance.multipliedBy(100).toFixed(1)}% (Buy: ${buyVolume.toFixed(2)}, Sell: ${sellVolume.toFixed(2)})`,
    };
  }

  /**
   * Calculate RSI-based signal
   */
  private calculateRSISignal(rsi: Decimal): {
    direction: Direction;
    confidence: Decimal;
    strength: Decimal;
    reason: string;
  } {
    let direction = Direction.NEUTRAL;
    let confidence = new Decimal(0);
    let strength = new Decimal(0);
    let reason = `RSI: ${rsi.toFixed(1)}`;

    if (rsi.lessThan(30)) {
      direction = Direction.LONG;
      strength = new Decimal(30).minus(rsi).dividedBy(30);
      confidence = strength.multipliedBy(0.8); // RSI signals are moderately reliable
      reason += ' (Oversold)';
    } else if (rsi.greaterThan(70)) {
      direction = Direction.SHORT;
      strength = rsi.minus(new Decimal(70)).dividedBy(30);
      confidence = strength.multipliedBy(0.8);
      reason += ' (Overbought)';
    } else {
      // Neutral zone - look for momentum
      const neutralDeviation = rsi.minus(new Decimal(50)).abs();
      if (neutralDeviation.greaterThan(10)) {
        direction = rsi.greaterThan(50) ? Direction.LONG : Direction.SHORT;
        strength = neutralDeviation.dividedBy(20);
        confidence = strength.multipliedBy(0.3); // Lower confidence in neutral zone
      }
    }

    return { direction, confidence, strength, reason };
  }

  /**
   * Calculate EMA-based signal
   */
  private calculateEMASignal(indicators: TechnicalIndicators): {
    direction: Direction;
    confidence: Decimal;
    strength: Decimal;
    reason: string;
  } {
    const ema20 = indicators.ema20;
    const ema50 = indicators.ema50;
    
    if (ema20.isZero() || ema50.isZero()) {
      return {
        direction: Direction.NEUTRAL,
        confidence: new Decimal(0),
        strength: new Decimal(0),
        reason: 'EMA data unavailable',
      };
    }

    const emaDiff = ema20.minus(ema50);
    const emaSpread = emaDiff.dividedBy(ema50).multipliedBy(100);
    const strength = emaSpread.abs().dividedBy(2).clampedTo(0, 1);
    const confidence = strength.multipliedBy(0.7); // Moderate confidence for EMA signals

    let direction = Direction.NEUTRAL;
    if (emaSpread.greaterThan(0.1)) {
      direction = Direction.LONG;
    } else if (emaSpread.lessThan(-0.1)) {
      direction = Direction.SHORT;
    }

    return {
      direction,
      confidence,
      strength,
      reason: `EMA20-EMA50 spread: ${emaSpread.toFixed(2)}%`,
    };
  }

  /**
   * Calculate Bollinger Bands signal
   */
  private calculateBollingerSignal(currentPrice: Decimal, indicators: TechnicalIndicators): {
    direction: Direction;
    confidence: Decimal;
    strength: Decimal;
    reason: string;
  } {
    const { bollingerUpper, bollingerLower } = indicators;
    
    if (bollingerUpper.isZero() || bollingerLower.isZero()) {
      return {
        direction: Direction.NEUTRAL,
        confidence: new Decimal(0),
        strength: new Decimal(0),
        reason: 'Bollinger Bands data unavailable',
      };
    }

    const bandWidth = bollingerUpper.minus(bollingerLower);
    let direction = Direction.NEUTRAL;
    let strength = new Decimal(0);
    let confidence = new Decimal(0);
    let reason = '';

    if (currentPrice.lessThan(bollingerLower)) {
      // Price below lower band - potential bounce up
      direction = Direction.LONG;
      strength = bollingerLower.minus(currentPrice).dividedBy(bandWidth);
      confidence = strength.multipliedBy(0.6);
      reason = 'Below Bollinger lower band';
    } else if (currentPrice.greaterThan(bollingerUpper)) {
      // Price above upper band - potential reversion down
      direction = Direction.SHORT;
      strength = currentPrice.minus(bollingerUpper).dividedBy(bandWidth);
      confidence = strength.multipliedBy(0.6);
      reason = 'Above Bollinger upper band';
    } else {
      // Price within bands - weak signal based on position
      const midBand = bollingerUpper.plus(bollingerLower).dividedBy(2);
      const position = currentPrice.minus(midBand).dividedBy(bandWidth.dividedBy(2));
      
      if (position.abs().greaterThan(0.5)) {
        direction = position.greaterThan(0) ? Direction.SHORT : Direction.LONG;
        strength = position.abs().minus(new Decimal(0.5)).multipliedBy(2);
        confidence = strength.multipliedBy(0.3);
        reason = `Within bands, ${position.greaterThan(0) ? 'upper' : 'lower'} bias`;
      }
    }

    return { direction, confidence, strength, reason };
  }

  /**
   * Calculate order flow signal
   */
  private calculateOrderFlowSignal(symbol: string): {
    direction: Direction;
    confidence: Decimal;
    strength: Decimal;
    reason: string;
  } {
    const trades = this.tradeHistory.get(symbol) || [];
    
    if (trades.length < 10) {
      return {
        direction: Direction.NEUTRAL,
        confidence: new Decimal(0),
        strength: new Decimal(0),
        reason: 'Insufficient order flow data',
      };
    }

    // Analyze recent aggressive trades (last 20)
    const recentTrades = trades.slice(-20);
    let aggressiveBuys = 0;
    let aggressiveSells = 0;

    recentTrades.forEach(trade => {
      // Assume larger trades are more aggressive
      const isAggressive = trade.size.greaterThan(
        recentTrades.reduce((sum, t) => sum.plus(t.size), new Decimal(0))
          .dividedBy(recentTrades.length)
          .multipliedBy(1.5)
      );

      if (isAggressive) {
        if (trade.side === 'buy') {
          aggressiveBuys++;
        } else {
          aggressiveSells++;
        }
      }
    });

    const totalAggressive = aggressiveBuys + aggressiveSells;
    if (totalAggressive === 0) {
      return {
        direction: Direction.NEUTRAL,
        confidence: new Decimal(0),
        strength: new Decimal(0),
        reason: 'No aggressive order flow detected',
      };
    }

    const flowImbalance = (aggressiveBuys - aggressiveSells) / totalAggressive;
    const strength = new Decimal(Math.abs(flowImbalance));
    const confidence = strength.multipliedBy(0.4); // Lower confidence for order flow

    let direction = Direction.NEUTRAL;
    if (flowImbalance > 0.3) {
      direction = Direction.LONG;
    } else if (flowImbalance < -0.3) {
      direction = Direction.SHORT;
    }

    return {
      direction,
      confidence,
      strength,
      reason: `Order flow: ${aggressiveBuys} aggressive buys, ${aggressiveSells} aggressive sells`,
    };
  }

  /**
   * Combine multiple signals with weights
   */
  private combineSignals(signals: Array<{
    signal: { direction: Direction; confidence: Decimal; strength: Decimal; reason: string };
    weight: number;
  }>): {
    direction: Direction;
    confidence: Decimal;
    strength: Decimal;
    reason: string;
  } {
    let longScore = new Decimal(0);
    let shortScore = new Decimal(0);
    let totalWeight = new Decimal(0);
    const reasons: string[] = [];

    signals.forEach(({ signal, weight }) => {
      const weightDecimal = new Decimal(weight);
      const score = signal.confidence.multipliedBy(signal.strength).multipliedBy(weightDecimal);
      
      if (signal.direction === Direction.LONG) {
        longScore = longScore.plus(score);
      } else if (signal.direction === Direction.SHORT) {
        shortScore = shortScore.plus(score);
      }
      
      totalWeight = totalWeight.plus(weightDecimal);
      
      if (signal.confidence.greaterThan(0.3)) {
        reasons.push(`${signal.reason} (${(weight * 100).toFixed(0)}%)`);
      }
    });

    const netScore = longScore.minus(shortScore);
    const totalScore = longScore.plus(shortScore);
    
    let direction = Direction.NEUTRAL;
    let confidence = new Decimal(0);
    let strength = new Decimal(0);

    if (totalScore.greaterThan(0)) {
      strength = totalScore.dividedBy(totalWeight);
      confidence = strength.multipliedBy(netScore.abs().dividedBy(totalScore));
      
      if (netScore.greaterThan(0.1)) {
        direction = Direction.LONG;
      } else if (netScore.lessThan(-0.1)) {
        direction = Direction.SHORT;
      }
    }

    return {
      direction,
      confidence: confidence.clampedTo(0, 1),
      strength: strength.clampedTo(0, 1),
      reason: reasons.length > 0 ? reasons.join('; ') : 'Combined signal analysis',
    };
  }

  /**
   * Apply signal smoothing to reduce noise
   */
  private applySignalSmoothing(symbol: string, newSignal: {
    direction: Direction;
    confidence: Decimal;
    strength: Decimal;
    reason: string;
  }): {
    direction: Direction;
    confidence: Decimal;
    strength: Decimal;
    reason: string;
  } {
    const lastSignal = this.lastSignals.get(symbol);
    if (!lastSignal) {
      return newSignal;
    }

    const smoothingFactor = new Decimal(this.config.signalSmoothing);
    const invSmoothingFactor = new Decimal(1).minus(smoothingFactor);

    // Smooth the confidence and strength
    const smoothedConfidence = lastSignal.confidence.multipliedBy(smoothingFactor)
      .plus(newSignal.confidence.multipliedBy(invSmoothingFactor));
    
    const smoothedStrength = lastSignal.strength.multipliedBy(smoothingFactor)
      .plus(newSignal.strength.multipliedBy(invSmoothingFactor));

    // Direction changes only if new signal is significantly stronger
    let direction = lastSignal.direction;
    if (newSignal.confidence.greaterThan(lastSignal.confidence.multipliedBy(1.2))) {
      direction = newSignal.direction;
    }

    return {
      direction,
      confidence: smoothedConfidence.clampedTo(0, 1),
      strength: smoothedStrength.clampedTo(0, 1),
      reason: `${newSignal.reason} (smoothed)`,
    };
  }

  /**
   * Calculate technical indicators for a symbol
   */
  private calculateTechnicalIndicators(symbol: string, prices: Decimal[]): TechnicalIndicators {
    try {
      const rsiValues = MathUtils.calculateRSI(prices, this.config.rsiPeriod);
      const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : new Decimal(50);

      const ema20Values = MathUtils.exponentialMovingAverage(prices, this.config.emaPeriods[0]);
      const ema20 = ema20Values.length > 0 ? ema20Values[ema20Values.length - 1] : new Decimal(0);

      const ema50Values = MathUtils.exponentialMovingAverage(prices, this.config.emaPeriods[1]);
      const ema50 = ema50Values.length > 0 ? ema50Values[ema50Values.length - 1] : new Decimal(0);

      const bollinger = MathUtils.calculateBollingerBands(
        prices, 
        this.config.bollingerPeriod, 
        this.config.bollingerStdDev
      );
      const bollingerUpper = bollinger.upper.length > 0 ? bollinger.upper[bollinger.upper.length - 1] : new Decimal(0);
      const bollingerLower = bollinger.lower.length > 0 ? bollinger.lower[bollinger.lower.length - 1] : new Decimal(0);

      // Simplified MACD calculation
      const ema12 = MathUtils.exponentialMovingAverage(prices, 12);
      const ema26 = MathUtils.exponentialMovingAverage(prices, 26);
      const macd = ema12.length > 0 && ema26.length > 0 
        ? ema12[ema12.length - 1].minus(ema26[ema26.length - 1])
        : new Decimal(0);
      
      const macdSignal = new Decimal(0); // Simplified - would need EMA of MACD

      return {
        rsi,
        ema20,
        ema50,
        bollingerUpper,
        bollingerLower,
        macd,
        macdSignal,
      };
    } catch (error) {
      logger.error('Error calculating technical indicators', { error, symbol });
      return {
        rsi: new Decimal(50),
        ema20: new Decimal(0),
        ema50: new Decimal(0),
        bollingerUpper: new Decimal(0),
        bollingerLower: new Decimal(0),
        macd: new Decimal(0),
        macdSignal: new Decimal(0),
      };
    }
  }

  private updatePriceHistory(marketData: MarketData): void {
    const prices = this.priceHistory.get(marketData.symbol) || [];
    prices.push(marketData.price);
    
    if (prices.length > this.maxHistoryLength) {
      prices.splice(0, prices.length - this.maxHistoryLength);
    }
    
    this.priceHistory.set(marketData.symbol, prices);
  }

  private updateVolumeHistory(marketData: MarketData): void {
    const volumes = this.volumeHistory.get(marketData.symbol) || [];
    volumes.push(marketData.volume24h);
    
    if (volumes.length > this.maxHistoryLength) {
      volumes.splice(0, volumes.length - this.maxHistoryLength);
    }
    
    this.volumeHistory.set(marketData.symbol, volumes);
  }

  /**
   * Get the latest signal for a symbol
   */
  getLatestSignal(symbol: string): Signal | null {
    return this.lastSignals.get(symbol) || null;
  }

  /**
   * Get technical indicators for a symbol
   */
  getTechnicalIndicators(symbol: string): TechnicalIndicators | null {
    return this.indicators.get(symbol) || null;
  }

  /**
   * Clear history for a symbol
   */
  clearHistory(symbol: string): void {
    this.priceHistory.delete(symbol);
    this.volumeHistory.delete(symbol);
    this.tradeHistory.delete(symbol);
    this.indicators.delete(symbol);
    this.lastSignals.delete(symbol);
  }

  /**
   * Get statistics about signal generation
   */
  getStatistics(): {
    symbols: number;
    totalSignals: number;
    avgHistoryLength: number;
    signalDistribution: Record<string, number>;
  } {
    const symbolCount = this.priceHistory.size;
    const totalSignals = this.lastSignals.size;
    
    let totalHistoryLength = 0;
    this.priceHistory.forEach(prices => {
      totalHistoryLength += prices.length;
    });
    const avgHistoryLength = symbolCount > 0 ? totalHistoryLength / symbolCount : 0;

    const signalDistribution: Record<string, number> = {
      LONG: 0,
      SHORT: 0,
      NEUTRAL: 0,
    };

    this.lastSignals.forEach(signal => {
      signalDistribution[signal.direction]++;
    });

    return {
      symbols: symbolCount,
      totalSignals,
      avgHistoryLength,
      signalDistribution,
    };
  }
}