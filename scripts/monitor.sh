const monitorScript = `#!/bin/bash

# Monitoring Script for Hyperliquid Trading Bot
echo "📊 Hyperliquid Trading Bot Monitor"
echo "=================================="

while true; do
  clear
  echo "📊 Hyperliquid Trading Bot Monitor - $(date)"
  echo "============================================"
  
  # Service Status
  echo -e "\n🔧 Service Status:"
  pm2 jlist | jq -r '.[] | select(.name == "hyperliquid-bot" or .name == "dashboard-server") | "\\(.name): \\(.pm2_env.status) (uptime: \\(.pm2_env.pm_uptime | . / 1000 | floor)s)"'
  
  # Quick Performance Check
  echo -e "\n📈 Quick Stats:"
  DASHBOARD_RESPONSE=$(curl -s --max-time 2 http://localhost:3000/api/status 2>/dev/null)
  if [ $? -eq 0 ]; then
    echo "$DASHBOARD_RESPONSE" | jq -r '"Strategy Running: " + (.strategy.isRunning | tostring)'
    echo "$DASHBOARD_RESPONSE" | jq -r '"Active Orders: " + (.strategy.activeOrders | tostring)'
    echo "$DASHBOARD_RESPONSE" | jq -r '"Risk Status: " + .risk.status'
  else
    echo "❌ Dashboard not responding"
  fi
  
  # Memory and CPU
  echo -e "\n💻 System Resources:"
  pm2 jlist | jq -r '.[] | select(.name == "hyperliquid-bot") | "Memory: \\(.monit.memory / 1024 / 1024 | floor)MB, CPU: \\(.monit.cpu)%"'
  
  # Recent Logs
  echo -e "\n📝 Recent Activity:"
  if [ -f "logs/trading.log" ]; then
    tail -3 logs/trading.log | jq -r '.timestamp + " - " + .message' 2>/dev/null || tail -3 logs/trading.log
  else
    echo "No trading logs found"
  fi
  
  echo -e "\n⏰ Auto-refresh in 10 seconds... (Ctrl+C to exit)"
  sleep 10
done
`;

export const scriptFiles = {
  'scripts/setup.js': setupScript,
  'scripts/deploy.sh': deployScript,
  'scripts/health-check.sh': healthCheckScript,
  'scripts/backup.sh': backupScript,
  'scripts/monitor.sh': monitorScript,
};

// === src/index.ts ===
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
    // Initialize Hyperliquid client
    this.client = new HyperliquidClient({
      apiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz',
      wsUrl: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
      apiKey: process.env.HYPERLIQUID_API_KEY || '',
      secret: process.env.HYPERLIQUID_SECRET || '',
      walletAddress: process.env.HYPERLIQUID_WALLET_ADDRESS || '',
      privateKey: process.env.HYPERLIQUID_PRIVATE_KEY || '',
      testnet: config.getTradingConfig().mode === 'testnet',
    });

    // Initialize WebSocket manager
    this.wsManager = new WebSocketManager({
      url: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
      reconnectDelay: Number(process.env.WS_RECONNECT_DELAY_MS) || 5000,
      maxReconnectAttempts: 10,
      pingInterval: 30000,
      pongTimeout: 10000,
    });

    // Initialize risk manager
    this.riskManager = new RiskManager(config.getRiskConfig());

    // Initialize signal generator
    this.signalGenerator = new SignalGenerator(config.getSignalConfig());

    // Initialize trading strategy
    this.strategy = new OneSidedQuotingStrategy(
      {
        symbols: config.getTradingConfig().symbols,
        maxPositionSize: new Decimal(config.getTradingConfig().maxPositionSize),
        baseOrderSize: new Decimal(config.getTradingConfig().baseOrderSize),
        confidenceThreshold: new Decimal(config.getTradingConfig().confidenceThreshold),
        targetFillRate: new Decimal(config.getTradingConfig().targetFillRate),
        aggressivenessFactor: new Decimal(config.getTradingConfig().aggressivenessFactor),
        quoteUpdateFrequency: 1000, // 1 second
        maxSpreadPercent: new Decimal(1), // 1%
        minSpreadTicks: 1,
        positionTimeoutMs: config.getRiskConfig().positionTimeoutMinutes * 60 * 1000,
        rebateThreshold: new Decimal(0.00003), // 0.003%
      },
      this.client,
      this.riskManager,
      this.signalGenerator
    );

    // Initialize dashboard
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
    // WebSocket event handlers
    this.wsManager.on('connected', () => {
      logger.info('WebSocket connected - subscribing to market data');
      config.getTradingConfig().symbols.forEach(symbol => {
        this.wsManager.subscribe('l2Book', symbol);
        this.wsManager.subscribe('trades', symbol);
      });
    });

    this.wsManager.on('marketData', (marketData) => {
      this.signalGenerator.processMarketData(marketData);
      this.strategy.processMarketData(marketData);
    });

    this.wsManager.on('orderBook', (orderBook) => {
      this.strategy.processOrderBook(orderBook);
    });

    this.wsManager.on('trade', (trade) => {
      this.signalGenerator.processTrade(trade);
    });

    // Risk management event handlers
    this.riskManager.on('emergencyStop', (alert) => {
      logger.error('EMERGENCY STOP TRIGGERED', alert);
      this.shutdown('Emergency stop triggered');
    });

    // Strategy event handlers
    this.strategy.on('orderPlaced', (order) => {
      logger.info('Order placed by strategy', {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        size: order.amount.toNumber(),
        price: order.price?.toNumber(),
      });
    });

    // Process handlers
    process.on('SIGINT', () => {
      logger.info('Received SIGINT - shutting down gracefully');
      this.shutdown('SIGINT received');
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM - shutting down gracefully');
      this.shutdown('SIGTERM received');
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      this.shutdown('Uncaught exception');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
    });
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting Hyperliquid Trading Bot Application');

      // Test API connectivity
      logger.info('Testing Hyperliquid API connectivity...');
      const connected = await this.client.testConnectivity();
      if (!connected) {
        throw new Error('Failed to connect to Hyperliquid API');
      }
      logger.info('✅ Hyperliquid API connectivity confirmed');

      // Start WebSocket connection
      logger.info('Connecting to Hyperliquid WebSocket...');
      await this.wsManager.connect();
      logger.info('✅ WebSocket connected successfully');

      // Start dashboard
      logger.info('Starting dashboard server...');
      await this.dashboard.start();
      logger.info('✅ Dashboard server started');

      // Start trading strategy
      if (config.getTradingConfig().mode === 'mainnet') {
        logger.info('Starting trading strategy in MAINNET mode...');
      } else {
        logger.info('Starting trading strategy in TESTNET mode...');
      }
      
      await this.strategy.start();
      logger.info('✅ Trading strategy started successfully');

      logger.info('🚀 Hyperliquid Trading Bot is now running!');
      logger.info(\`📊 Dashboard: http://localhost:\${config.getSystemConfig().dashboardPort}\`);
      logger.info(\`📈 Metrics: http://localhost:\${config.getSystemConfig().metricsPort}\`);

    } catch (error) {
      logger.error('Failed to start application', error);
      throw error;
    }
  }

  async shutdown(reason: string): Promise<void> {
    logger.info(\`Shutting down application: \${reason}\`);

    try {
      // Stop trading strategy
      await this.strategy.stop();
      logger.info('✅ Trading strategy stopped');

      // Disconnect WebSocket
      this.wsManager.disconnect();
      logger.info('✅ WebSocket disconnected');

      // Stop dashboard
      await this.dashboard.stop();
      logger.info('✅ Dashboard stopped');

      logger.info('✅ Application shutdown completed');
      process.exit(0);

    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const app = new TradingBotApplication();
  
  try {
    await app.start();
  } catch (error) {
    logger.error('Application startup failed', error);
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled application error', error);
    process.exit(1);
  });
}

export { TradingBotApplication };
