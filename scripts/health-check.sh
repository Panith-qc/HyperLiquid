const healthCheckScript = `#!/bin/bash

# Health Check Script for Hyperliquid Trading Bot
echo "🏥 Hyperliquid Trading Bot Health Check"
echo "========================================"

# Check if services are running
echo "\n📊 Service Status:"
pm2 jlist | jq -r '.[] | select(.name == "hyperliquid-bot" or .name == "dashboard-server") | "\\(.name): \\(.pm2_env.status)"'

# Check memory usage
echo "\n💾 Memory Usage:"
pm2 jlist | jq -r '.[] | select(.name == "hyperliquid-bot" or .name == "dashboard-server") | "\\(.name): \\(.monit.memory / 1024 / 1024 | floor)MB"'

# Check CPU usage
echo "\n⚡ CPU Usage:"
pm2 jlist | jq -r '.[] | select(.name == "hyperliquid-bot" or .name == "dashboard-server") | "\\(.name): \\(.monit.cpu)%"'

# Check disk space
echo "\n💿 Disk Usage:"
df -h . | tail -1 | awk '{print "Available: " $4 " (" $5 " used)"}'

# Check log files
echo "\n📝 Log Files:"
if [ -d "logs" ]; then
  du -sh logs/* 2>/dev/null | head -5
else
  echo "No logs directory found"
fi

# Check network connectivity
echo "\n🌐 Network Connectivity:"
if curl -s --max-time 5 https://api.hyperliquid.xyz/info >/dev/null; then
  echo "✅ Hyperliquid API reachable"
else
  echo "❌ Hyperliquid API unreachable"
fi

# Check configuration
echo "\n⚙️  Configuration:"
if [ -f ".env" ]; then
  echo "✅ .env file exists"
  # Check critical environment variables
  if grep -q "HYPERLIQUID_API_KEY=your_api_key_here" .env; then
    echo "⚠️  API key not configured"
  else
    echo "✅ API key configured"
  fi
else
  echo "❌ .env file missing"
fi

# Check recent errors
echo "\n🚨 Recent Errors (last 24h):"
if [ -f "logs/error.log" ]; then
  tail -20 logs/error.log | grep "$(date -d '1 day ago' '+%Y-%m-%d')" | wc -l | awk '{print $1 " errors found"}'
else
  echo "No error log found"
fi

# API Health Check
echo "\n🔍 API Health:"
HEALTH_RESPONSE=$(curl -s --max-time 5 http://localhost:3002/health 2>/dev/null)
if [ $? -eq 0 ]; then
  echo "✅ Health endpoint responsive"
  echo "$HEALTH_RESPONSE" | jq '.status' 2>/dev/null || echo "$HEALTH_RESPONSE"
else
  echo "❌ Health endpoint not responding"
fi

# Dashboard Check
echo "\n🖥️  Dashboard Status:"
if curl -s --max-time 5 http://localhost:3000 >/dev/null; then
  echo "✅ Dashboard accessible"
else
  echo "❌ Dashboard not accessible"
fi

echo "\n✅ Health check completed"
`;
