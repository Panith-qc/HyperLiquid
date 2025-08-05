export interface SystemHealth {
  timestamp: number;
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  uptime: number;
  memoryUsage: MemoryUsage;
  cpuUsage: number;
  connections: ConnectionStatus;
  latency: LatencyMetrics;
}

export interface MemoryUsage {
  used: number;
  total: number;
  percentage: number;
  heapUsed: number;
  heapTotal: number;
}

export interface ConnectionStatus {
  hyperliquid: boolean;
  redis: boolean;
  database: boolean;
  websocket: boolean;
}

export interface LatencyMetrics {
  api: number;
  websocket: number;
  database: number;
  redis: number;
}

export interface Configuration {
  trading: TradingConfig;
  risk: RiskConfig;
  signals: SignalConfig;
  system: SystemConfig;
  monitoring: MonitoringConfig;
}

export interface TradingConfig {
  mode: 'testnet' | 'mainnet';
  symbols: string[];
  maxPositionSize: number;
  baseOrderSize: number;
  confidenceThreshold: number;
  targetFillRate: number;
  aggressivenessFactor: number;
}

export interface RiskConfig {
  maxDailyLoss: number;
  maxDrawdownPercent: number;
  positionTimeoutMinutes: number;
  riskCheckIntervalMs: number;
  emergencyStopLossPercent: number;
}

export interface SignalConfig {
  momentumPeriods: number[];
  volumeThreshold: number;
  technicalIndicators: string[];
  signalSmoothing: number;
}

export interface SystemConfig {
  logLevel: string;
  metricsPort: number;
  dashboardPort: number;
  healthCheckPort: number;
  redisUrl: string;
  databaseUrl: string;
}

export interface MonitoringConfig {
  alertWebhookUrl?: string;
  slackWebhookUrl?: string;
  emailAlertsEnabled: boolean;
}