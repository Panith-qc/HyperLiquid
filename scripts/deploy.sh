const deployScript = `#!/bin/bash

# Hyperliquid Trading Bot Deployment Script
echo "🚀 Deploying Hyperliquid Trading Bot..."

# Check if running as root
if [ "$EUID" -eq 0 ]; then
  echo "❌ Do not run this script as root"
  exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if ! node -e "process.exit(require('semver').gte('$NODE_VERSION', '$REQUIRED_VERSION') ? 0 : 1)" 2>/dev/null; then
  echo "❌ Node.js version $REQUIRED_VERSION or higher required. Found: $NODE_VERSION"
  exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
  echo "❌ .env file not found. Please create it from .env.example"
  exit 1
fi

# Install dependencies
echo "📦 Installing production dependencies..."
npm ci --production

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Run tests
echo "🧪 Running tests..."
npm test

# Check PM2 installation
if ! command -v pm2 &> /dev/null; then
  echo "📦 Installing PM2..."
  npm install -g pm2
fi

# Stop existing processes
echo "🛑 Stopping existing processes..."
pm2 stop hyperliquid-bot 2>/dev/null || true
pm2 stop dashboard-server 2>/dev/null || true

# Start services with PM2
echo "▶️  Starting services..."
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup (if not already configured)
pm2 startup

# Setup log rotation
pm2 install pm2-logrotate

echo "✅ Deployment completed successfully!"
echo ""
echo "📊 Service status:"
pm2 status

echo ""
echo "🔗 Dashboard: http://localhost:3000"
echo "📈 Metrics: http://localhost:3001"
echo "🏥 Health: http://localhost:3002"
echo ""
echo "📋 Useful commands:"
echo "- pm2 status           # Check service status"
echo "- pm2 logs             # View logs"
echo "- pm2 monit            # Real-time monitoring"
echo "- pm2 restart all      # Restart all services"
echo "- pm2 stop all         # Stop all services"
`;