import { logger } from '../src/utils/logger';

// Configure test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Global test setup
beforeAll(async () => {
  logger.info('Test suite starting');
});

afterAll(async () => {
  logger.info('Test suite completed');
});

// === tests/unit/signal-generator.test.ts ===
import { SignalGenerator } from '../../src/strategies/signal-generator';
import { MarketData, Direction } from '../../src/types';
import { Decimal } from 'decimal.js';

describe('SignalGenerator', () => {
  let signalGenerator: SignalGenerator;

  beforeEach(() => {
    signalGenerator = new SignalGenerator({
      momentumPeriods: [5, 15],
      volumeThreshold: 1.5,
      rsiPeriod: 14,
      emaPeriods: [20, 50],
      bollingerPeriod: 20,
      bollingerStdDev: 2,
      signalSmoothing: 0.3,
      minConfidence: 0.6,
    });
  });

  describe('processMarketData', () => {
    it('should process market data without errors', () => {
      const marketData: MarketData = {
        symbol: 'ETH',
        timestamp: Date.now(),
        price: new Decimal(2000),
        bid: new Decimal(1999.5),
        ask: new Decimal(2000.5),
        bidSize: new Decimal(10),
        askSize: new Decimal(8),
        volume24h: new Decimal(1000000),
        change24h: new Decimal(2.5),
        spread: new Decimal(1),
        midPrice: new Decimal(2000),
      };

      expect(() => {
        signalGenerator.processMarketData(marketData);
      }).not.toThrow();
    });

    it('should generate signals with sufficient data', async () => {
      const signalPromise = new Promise((resolve) => {
        signalGenerator.once('signal', resolve);
      });

      // Feed enough data to generate signals
      for (let i = 0; i < 100; i++) {
        const price = new Decimal(2000 + Math.random() * 100 - 50);
        const marketData: MarketData = {
          symbol: 'ETH',
          timestamp: Date.now() + i * 1000,
          price,
          bid: price.minus(0.5),
          ask: price.plus(0.5),
          bidSize: new Decimal(10),
          askSize: new Decimal(8),
          volume24h: new Decimal(1000000 + Math.random() * 100000),
          change24h: new Decimal(Math.random() * 10 - 5),
          spread: new Decimal(1),
          midPrice: price,
        };
        
        signalGenerator.processMarketData(marketData);
      }

      const signal = await signalPromise;
      expect(signal).toBeDefined();
      expect(signal.symbol).toBe('ETH');
      expect([Direction.LONG, Direction.SHORT, Direction.NEUTRAL]).toContain(signal.direction);
    });
  });

  describe('getLatestSignal', () => {
    it('should return null for unknown symbol', () => {
      const signal = signalGenerator.getLatestSignal('UNKNOWN');
      expect(signal).toBeNull();
    });
  });

  describe('getStatistics', () => {
    it('should return valid statistics', () => {
      const stats = signalGenerator.getStatistics();
      expect(stats).toHaveProperty('symbols');
      expect(stats).toHaveProperty('totalSignals');
      expect(stats).toHaveProperty('avgHistoryLength');
      expect(stats).toHaveProperty('signalDistribution');
    });
  });
});

// === tests/unit/risk-manager.test.ts ===
import { RiskManager } from '../../src/core/risk-manager';
import { Position, OrderSide } from '../../src/types';
import { Decimal } from 'decimal.js';

describe('RiskManager', () => {
  let riskManager: RiskManager;

  beforeEach(() => {
    riskManager = new RiskManager({
      maxPositionSize: 1000,
      maxDailyLoss: 500,
      maxDrawdownPercent: 5,
      positionTimeoutMinutes: 30,
      riskCheckIntervalMs: 1000,
      emergencyStopLossPercent: 10,
      concentrationLimit: 0.3,
      maxOpenPositions: 5,
      correlationLimit: 0.7,
      volatilityThreshold: 20,
    });
  });

  describe('canTrade', () => {
    it('should allow trading with healthy risk metrics', () => {
      expect(riskManager.canTrade('ETH')).toBe(true);
    });

    it('should block trading when emergency stop is active', () => {
      // Trigger emergency stop
      riskManager.triggerEmergencyStop();
      expect(riskManager.canTrade('ETH')).toBe(false);
    });
  });

  describe('getMaxPositionSize', () => {
    it('should return valid position size', () => {
      const maxSize = riskManager.getMaxPositionSize('ETH', new Decimal(100));
      expect(maxSize.greaterThanOrEqualTo(0)).toBe(true);
      expect(maxSize.lessThanOrEqualTo(1000)).toBe(true);
    });

    it('should limit size based on daily loss', () => {
      // Simulate large daily loss
      const position: Position = {
        symbol: 'ETH',
        side: OrderSide.BUY,
        size: new Decimal(1),
        entryPrice: new Decimal(2000),
        markPrice: new Decimal(1500), // Large unrealized loss
        unrealizedPnl: new Decimal(-500),
        realizedPnl: new Decimal(0),
        timestamp: Date.now(),
        fees: new Decimal(0),
        rebates: new Decimal(0),
      };

      riskManager.updatePosition(position);
      
      const maxSize = riskManager.getMaxPositionSize('BTC', new Decimal(100));
      expect(maxSize.lessThan(100)).toBe(true);
    });
  });

  describe('updatePosition', () => {
    it('should update position and calculate metrics', () => {
      const position: Position = {
        symbol: 'ETH',
        side: OrderSide.BUY,
        size: new Decimal(1),
        entryPrice: new Decimal(2000),
        markPrice: new Decimal(2100),
        unrealizedPnl: new Decimal(100),
        realizedPnl: new Decimal(0),
        timestamp: Date.now(),
        fees: new Decimal(1),
        rebates: new Decimal(0.06),
      };

      riskManager.updatePosition(position);
      
      const retrievedPosition = riskManager.getPosition('ETH');
      expect(retrievedPosition).toBeDefined();
      expect(retrievedPosition!.symbol).toBe('ETH');
    });
  });

  describe('getRiskMetrics', () => {
    it('should return current risk metrics', () => {
      const metrics = riskManager.getRiskMetrics();
      expect(metrics).toHaveProperty('totalExposure');
      expect(metrics).toHaveProperty('currentDrawdown');
      expect(metrics).toHaveProperty('dailyPnl');
    });
  });
});