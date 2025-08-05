import { Configuration } from '@/types';
import { logger } from '@/utils/logger';
import { ValidationUtils } from '@/utils/validation';
import Joi from 'joi';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export class ConfigManager {
  private static instance: ConfigManager;
  private config: Configuration;

  private constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): Configuration {
    return {
      trading: {
        mode: (process.env.TRADING_MODE as 'testnet' | 'mainnet') || 'testnet',
        symbols: process.env.TRADING_SYMBOLS?.split(',') || ['ETH', 'BTC'],
        maxPositionSize: Number(process.env.MAX_POSITION_SIZE) || 1000,
        baseOrderSize: Number(process.env.BASE_ORDER_SIZE) || 100,
        confidenceThreshold: Number(process.env.CONFIDENCE_THRESHOLD) || 0.7,
        targetFillRate: Number(process.env.TARGET_FILL_RATE) || 0.65,
        aggressivenessFactor: Number(process.env.AGGRESSIVENESS_FACTOR) || 0.5,
      },
      risk: {
        maxDailyLoss: Number(process.env.MAX_DAILY_LOSS) || 500,
        maxDrawdownPercent: Number(process.env.MAX_DRAWDOWN_PERCENT) || 5,
        positionTimeoutMinutes: Number(process.env.POSITION_TIMEOUT_MINUTES) || 30,
        riskCheckIntervalMs: Number(process.env.RISK_CHECK_INTERVAL_MS) || 1000,
        emergencyStopLossPercent: Number(process.env.EMERGENCY_STOP_LOSS_PERCENT) || 10,
      },
      signals: {
        momentumPeriods: process.env.MOMENTUM_PERIODS?.split(',').map(Number) || [5, 15, 30],
        volumeThreshold: Number(process.env.VOLUME_THRESHOLD) || 1.5,
        technicalIndicators: process.env.TECHNICAL_INDICATORS?.split(',') || ['RSI', 'EMA', 'BOLLINGER'],
        signalSmoothing: Number(process.env.SIGNAL_SMOOTHING) || 0.3,
      },
      system: {
        logLevel: process.env.LOG_LEVEL || 'info',
        metricsPort: Number(process.env.METRICS_PORT) || 3001,
        dashboardPort: Number(process.env.DASHBOARD_PORT) || 3000,
        healthCheckPort: Number(process.env.HEALTH_CHECK_PORT) || 3002,
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
        databaseUrl: process.env.DATABASE_URL || 'sqlite:./data/trading.db',
      },
      monitoring: {
        alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
        emailAlertsEnabled: process.env.EMAIL_ALERTS_ENABLED === 'true',
      },
    };
  }

  private validateConfig(): void {
    const validation = ValidationUtils.validateConfig(this.config);
    if (!validation.isValid) {
      logger.error('Configuration validation failed', { errors: validation.errors });
      throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }
    logger.info('Configuration validated successfully');
  }

  getConfig(): Configuration {
    return this.config;
  }

  getTradingConfig() {
    return this.config.trading;
  }

  getRiskConfig() {
    return this.config.risk;
  }

  getSignalConfig() {
    return this.config.signals;
  }

  getSystemConfig() {
    return this.config.system;
  }

  getMonitoringConfig() {
    return this.config.monitoring;
  }

  updateConfig(newConfig: Partial<Configuration>): void {
    this.config = { ...this.config, ...newConfig };
    this.validateConfig();
    logger.info('Configuration updated');
  }

  isProduction(): boolean {
    return this.config.trading.mode === 'mainnet';
  }

  isDevelopment(): boolean {
    return this.config.trading.mode === 'testnet';
  }
}

export const config = ConfigManager.getInstance();