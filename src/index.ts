import { logger } from '@/utils/logger';
import { config } from '@/config';
import { HyperliquidClient } from '@/api/hyperliquid-api';
import { WebSocketManager } from '@/core/websocket-manager';
import { RiskManager } from '@/core/risk-manager';
import { SignalGenerator } from '@/strategies/signal-generator';
import { OneSidedQuotingStrategy } from '@/strategies/one-sided-quoting';
import { Dashboard } from '@/monitoring/dashboard';
import { Decimal } from 'decimal.js';

class TradingBotApplication {
  private client: HyperliquidClient;
  private wsManager: WebSocketManager;
  private riskManager: RiskManager;
  private signalGenerator: SignalGenerator;
  private strategy: OneSidedQuotingStrategy;
  private dashboard: Dashboard;

  constructor() {
    this.initializeComponents();
    this.setupEventHandlers();
  }

  private initializeComponents(): void {
    // Initialize components with configuration
    this.client = new HyperliquidClient({
      apiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz',
      wsUrl: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
      apiKey: process.env.HYPERLIQUID_API_KEY || '',
      secret: process.env.HYPERLIQUID_SECRET || '',
      walletAddress: process.env.HYPERLIQUID_WALLET_ADDRESS || '',
      privateKey: process.env.HYPERLIQUID_PRIVATE_KEY || '',
      testnet: config.getTradingConfig().mode === 'testnet',
    });

    this.wsManager = new WebSocketManager({
      url: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
    });

    this.riskManager = new RiskManager(config.getRiskConfig());
    this.signalGenerator = new SignalGenerator(config.getSignalConfig());
    
    // Initialize strategy with all dependencies
    this.strategy = new OneSidedQuotingStrategy(
      {
        symbols: config.getTradingConfig().symbols,
        maxPositionSize: new Decimal(config.getTradingConfig().maxPositionSize),
        baseOrderSize: new Decimal(config.getTradingConfig().baseOrderSize),
        confidenceThreshold: new Decimal(config.getTradingConfig().confidenceThreshold),
        targetFillRate: new Decimal(config.getTradingConfig().targetFillRate),
        aggressivenessFactor: new Decimal(config.getTradingConfig().aggressivenessFactor),
        quoteUpdateFrequency: 1000,
        maxSpreadPercent: new Decimal(1),
        minSpreadTicks: 1,
        positionTimeoutMs: config.getRiskConfig().positionTimeoutMinutes * 60 * 1000,
        rebateThreshold: new Decimal(0.00003),
      },
      this.client,
      this.riskManager,
      this.signalGenerator
    );

    this.dashboard = new Dashboard(
      {
        port: config.getSystemConfig().dashboardPort,
        refreshInterval: 5000,
        enableAuth: false,
      },
      this.riskManager,
      this.strategy
    );
  }

  private setupEventHandlers(): void {
    // WebSocket events
    this.wsManager.on('connected', () => {
      logger.info('WebSocket connected');
      config.getTradingConfig().symbols.forEach(symbol => {
        this.wsManager.subscribe('l2Book', symbol);
        this.wsManager.subscribe('trades', symbol);
      });
    });

    this.wsManager.on('marketData', (marketData) => {
      this.signalGenerator.processMarketData(marketData);
      this.strategy.processMarketData(marketData);
    });

    // Process shutdown handlers
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
  }

  async start(): Promise<void> {
    logger.info('Starting Hyperliquid Trading Bot');
    
    // Start all components
    await this.wsManager.connect();
    await this.dashboard.start();
    await this.strategy.start();
    
    logger.info('🚀 Trading Bot started successfully!');
  }

  async shutdown(reason: string): Promise<void> {
    logger.info(`Shutting down: ${reason}`);
    
    await this.strategy.stop();
    this.wsManager.disconnect();
    await this.dashboard.stop();
    
    process.exit(0);
  }
}

// Start application
if (require.main === module) {
  const app = new TradingBotApplication();
  app.start().catch(error => {
    logger.error('Failed to start application', error);
    process.exit(1);
  });
}