# 🎯 Technical Overview

## Strategy Implementation

### One-Sided Quoting Logic
Unlike traditional market making, this bot implements directional liquidity provision:

```typescript
// One-sided quoting strategy
if (signal.direction === Direction.LONG) {
    placeBidOrder(symbol, price, size);     // BUY-only
    cancelAllAskOrders(symbol);             // No SELL orders
} else if (signal.direction === Direction.SHORT) {
    placeAskOrder(symbol, price, size);     // SELL-only  
    cancelAllBidOrders(symbol);             // No BUY orders
}
```

### Signal Generation
Multi-factor analysis combining:
- **Momentum**: Price velocity over multiple timeframes
- **Volume**: Buy/sell imbalance detection
- **Technical Indicators**: RSI, EMA, Bollinger Bands
- **Order Flow**: Aggressive trade pattern analysis

### Risk Management
- **Position Limits**: Per-symbol and total exposure controls
- **Drawdown Protection**: Real-time monitoring with auto-stops
- **Time Management**: Position timeout and decay algorithms
- **Emergency Controls**: Multi-level circuit breakers

### Performance Optimization
- **Latency**: <100ms market-data-to-order pipeline
- **Fill Rate**: Dynamic pricing for 65-70% execution rate
- **Rebate Capture**: Precise maker order placement
- **Adverse Selection Protection**: Smart quote positioning

## Architecture

Event-driven design with real-time processing:
```
Market Data → Signal Generation → Strategy → Risk Management → Order Execution
```

## Deployment

Production-ready with:
- Docker containerization
- PM2 process management  
- Prometheus monitoring
- Grafana analytics
- Automated backup/recovery