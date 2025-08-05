import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger } from '@/utils/logger';

export class RateLimiter {
  private limiter: RateLimiterMemory;
  private burstLimiter: RateLimiterMemory;

  constructor() {
    // Main rate limiter: 10 requests per second
    this.limiter = new RateLimiterMemory({
      keyGenerator: () => 'api',
      points: 10, // Number of requests
      duration: 1, // Per 1 second
    });

    // Burst protection: 100 requests per minute
    this.burstLimiter = new RateLimiterMemory({
      keyGenerator: () => 'api-burst',
      points: 100,
      duration: 60,
    });
  }

  async checkLimit(): Promise<void> {
    try {
      await Promise.all([
        this.limiter.consume('api'),
        this.burstLimiter.consume('api-burst'),
      ]);
    } catch (rejRes: any) {
      const remainingMs = rejRes.msBeforeNext || 1000;
      logger.warn('Rate limit hit, waiting', { waitMs: remainingMs });
      
      await new Promise(resolve => setTimeout(resolve, remainingMs));
      
      // Retry once
      await Promise.all([
        this.limiter.consume('api'),
        this.burstLimiter.consume('api-burst'),
      ]);
    }
  }

  async getRemainingPoints(): Promise<{ perSecond: number; perMinute: number }> {
    const [secondRes, minuteRes] = await Promise.all([
      this.limiter.get('api'),
      this.burstLimiter.get('api-burst'),
    ]);

    return {
      perSecond: secondRes ? secondRes.remainingPoints : 10,
      perMinute: minuteRes ? minuteRes.remainingPoints : 100,
    };
  }
}
