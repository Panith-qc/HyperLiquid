# Hyperliquid One-Sided Quoting Trading Bot

**Enterprise-grade algorithmic trading system for Hyperliquid rebate farming**

## Overview

Sophisticated one-sided quoting trading bot designed for Hyperliquid's perpetual futures platform. Implements directional liquidity provision strategy that eliminates inventory risk while maximizing maker rebate capture at 0.003% per fill.

## ✨ Key Features

 **One-Sided Quoting Strategy** - Posts only bids OR asks, eliminating inventory risk  
 **Rebate Optimization** - Targets 0.003% maker rebates with high fill rates  
 **Advanced Signal Generation** - Multi-timeframe momentum and volume analysis  
 **Enterprise Risk Management** - Multi-layer risk controls  
 **Real-time Dashboard** - Professional monitoring interface  
 **Sub-100ms Latency** - Optimized for high-frequency rebate capture  

##  Quick Start

### Installation
```bash
# Clone and setup
git clone <repository>
cd hyperliquid-trading-bot-enterprise
chmod +x scripts/*.sh
./scripts/setup.js
```

### Configuration
```bash
# Configure environment
cp .env.example .env
# Edit .env with your Hyperliquid API credentials
```

### Run
```bash
# Development mode
npm run dev

# Production mode
./scripts/deploy.sh

# Access dashboard
open http://localhost:3000
```

##  Strategy

### One-Sided Quoting Logic
- **LONG Signal**: Posts only BUY orders (bids), cancels all SELL orders
- **SHORT Signal**: Posts only SELL orders (asks), cancels all BUY orders  
- **NEUTRAL**: No active orders, wait for clear directional signal

### Rebate Economics
- **Maker Rebate**: 0.003% per fill on Hyperliquid
- **Target Volume**: $1M+ daily for meaningful rebate revenue
- **Fill Rate**: 65-70% of posted quotes should execute
- **No Inventory Risk**: Directional positioning eliminates adverse selection

##  Performance Targets

- **Latency**: <100ms quote updates
- **Fill Rate**: 65-70% of posted quotes
- **Rebate Capture**: >95% maker classification
- **Max Drawdown**: <5% with risk management
- **Sharpe Ratio**: Target >2.0

##  Architecture

- **Signal Generation**: Multi-factor analysis (momentum, volume, technicals)
- **Risk Management**: Real-time monitoring with emergency stops  
- **Order Management**: High-performance execution with fill tracking
- **Monitoring**: Real-time dashboard with performance analytics

## Requirements

- Node.js 18+
- Hyperliquid API credentials
- 2GB RAM minimum
- Low-latency internet connection

##  Configuration

Key environment variables:
- `TRADING_MODE`: testnet | mainnet
- `MAX_POSITION_SIZE`: Maximum position size ($)
- `MAX_DAILY_LOSS`: Daily loss limit ($)
- `CONFIDENCE_THRESHOLD`: Minimum signal confidence
- `TARGET_FILL_RATE`: Target quote fill rate

##  Monitoring

- **Dashboard**: http://localhost:3000
- **Metrics**: Real-time P&L, rebates, risk status
- **Alerts**: Slack/email notifications for critical events
- **Logs**: Comprehensive audit trail

##  Disclaimer

Trading involves substantial risk. This software is for educational purposes. Use at your own risk.

##  License

MIT License - see LICENSE file for details.