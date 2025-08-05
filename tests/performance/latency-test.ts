import { HyperliquidClient } from '../../src/api/hyperliquid-api';
import { SignalGenerator } from '../../src/strategies/signal-generator';
import { MarketData } from '../../src/types';
import { Decimal } from 'decimal.js';

describe('Performance Tests', () => {
  describe('Signal Generation Latency', () => {
    let signalGenerator: SignalGenerator;

    beforeEach(() => {
      signalGenerator = new SignalGenerator({
        momentumPeriods: [5, 15, 30],
        volumeThreshold: 1.5,
        rsiPeriod: 14,
        emaPeriods: [20, 50],
        bollingerPeriod: 20,
        bollingerStdDev: 2,
        signalSmoothing: 0.3,
        minConfidence: 0.6,
      });
    });

    it('should process market data within 10ms', () => {
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

      const startTime = process.hrtime.bigint();
      signalGenerator.processMarketData(marketData);
      const endTime = process.hrtime.bigint();
      
      const latencyMs = Number(endTime - startTime) / 1000000;
      expect(latencyMs).toBeLessThan(10);
    });

    it('should handle high-frequency updates efficiently', () => {
      const iterations = 1000;
      const startTime = process.hrtime.bigint();

      for (let i = 0; i < iterations; i++) {
        const marketData: MarketData = {
          symbol: 'ETH',
          timestamp: Date.now() + i,
          price: new Decimal(2000 + Math.random() * 10),
          bid: new Decimal(1999.5),
          ask: new Decimal(2000.5),
          bidSize: new Decimal(10),
          askSize: new Decimal(8),
          volume24h: new Decimal(1000000),
          change24h: new Decimal(2.5),
          spread: new Decimal(1),
          midPrice: new Decimal(2000),
        };
        
        signalGenerator.processMarketData(marketData);
      }

      const endTime = process.hrtime.bigint();
      const totalLatencyMs = Number(endTime - startTime) / 1000000;
      const avgLatencyMs = totalLatencyMs / iterations;
      
      expect(avgLatencyMs).toBeLessThan(1); // Average < 1ms per update
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory during extended operation', () => {
      const signalGenerator = new SignalGenerator({
        momentumPeriods: [5, 15],
        volumeThreshold: 1.5,
        rsiPeriod: 14,
        emaPeriods: [20, 50],
        bollingerPeriod: 20,
        bollingerStdDev: 2,
        signalSmoothing: 0.3,
        minConfidence: 0.6,
      });

      const initialMemory = process.memoryUsage().heapUsed;
      
      // Simulate extended operation
      for (let i = 0; i < 10000; i++) {
        const marketData: MarketData = {
          symbol: 'ETH',
          timestamp: Date.now() + i,
          price: new Decimal(2000 + Math.random() * 100),
          bid: new Decimal(1999.5),
          ask: new Decimal(2000.5),
          bidSize: new Decimal(10),
          askSize: new Decimal(8),
          volume24h: new Decimal(1000000),
          change24h: new Decimal(2.5),
          spread: new Decimal(1),
          midPrice: new Decimal(2000),
        };
        
        signalGenerator.processMarketData(marketData);
      }

      global.gc?.(); // Force garbage collection if available
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (< 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });
});