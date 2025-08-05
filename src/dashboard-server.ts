import { logger } from '@/utils/logger';
import { config } from '@/config';
import { RiskManager } from '@/core/risk-manager';
import { OneSidedQuotingStrategy } from '@/strategies/one-sided-quoting';
import { Dashboard } from '@/monitoring/dashboard';
import { Decimal } from 'decimal.js';

// Mock components for dashboard-only mode
const mockRiskManager = new RiskManager(config.getRiskConfig());
const mockStrategy = {
  getStatistics: () => ({
    isRunning: false,
    activeOrders: 0,
    positions: 0,
    totalRebates: new Decimal(0),
    fillRate: new Decimal(0),
    avgFillTime: 0,
  }),
  start: async () => {},
  stop: async () => {},
} as any;

async function startDashboardServer(): Promise<void> {
  try {
    logger.info('Starting Dashboard Server...');

    const dashboard = new Dashboard(
      {
        port: config.getSystemConfig().dashboardPort,
        refreshInterval: 5000,
        enableAuth: false,
      },
      mockRiskManager,
      mockStrategy
    );

    await dashboard.start();
    
    logger.info('🎮 Dashboard Server started successfully!');
    logger.info(\`📊 Dashboard URL: http://localhost:\${config.getSystemConfig().dashboardPort}\`);

  } catch (error) {
    logger.error('Failed to start dashboard server', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', () => {
  logger.info('Dashboard server shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Dashboard server shutting down...');
  process.exit(0);
});

// Start dashboard server
if (require.main === module) {
  startDashboardServer();
}
