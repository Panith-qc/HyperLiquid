import winston from 'winston';
import path from 'path';

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Define log colors
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
};

winston.addColors(logColors);

// Create logger instance
export const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSS',
    }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.colorize({ all: true })
  ),
  defaultMeta: { service: 'hyperliquid-bot' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
          return `[${timestamp}] ${level} [${service}]: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
          }`;
        })
      ),
    }),
    
    // File transports
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'trading.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

// Create specialized loggers
export const tradingLogger = winston.createLogger({
  levels: logLevels,
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'trading' },
  transports: [
    new winston.transports.File({
      filename: path.join('logs', 'trading', 'trades.log'),
      maxsize: 10485760,
      maxFiles: 20,
    }),
  ],
});

export const systemLogger = winston.createLogger({
  levels: logLevels,
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'system' },
  transports: [
    new winston.transports.File({
      filename: path.join('logs', 'system', 'system.log'),
      maxsize: 5242880,
      maxFiles: 10,
    }),
  ],
});

export const auditLogger = winston.createLogger({
  levels: logLevels,
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'audit' },
  transports: [
    new winston.transports.File({
      filename: path.join('logs', 'audit', 'audit.log'),
      maxsize: 10485760,
      maxFiles: 50,
    }),
  ],
});
