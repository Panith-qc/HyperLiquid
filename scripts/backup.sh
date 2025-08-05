const backupScript = `#!/bin/bash

# Backup Script for Hyperliquid Trading Bot
BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
echo "💾 Creating backup in: $BACKUP_DIR"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup configuration
echo "📄 Backing up configuration..."
cp .env "$BACKUP_DIR/" 2>/dev/null || echo "⚠️  .env not found"
cp package.json "$BACKUP_DIR/"
cp ecosystem.config.js "$BACKUP_DIR/"

# Backup data
echo "💿 Backing up data..."
if [ -d "data" ]; then
  cp -r data "$BACKUP_DIR/"
else
  echo "⚠️  No data directory found"
fi

# Backup logs (last 7 days only)
echo "📝 Backing up recent logs..."
if [ -d "logs" ]; then
  mkdir -p "$BACKUP_DIR/logs"
  find logs -type f -mtime -7 -exec cp {} "$BACKUP_DIR/logs/" \;
else
  echo "⚠️  No logs directory found"
fi

# Backup PM2 configuration
echo "⚙️  Backing up PM2 configuration..."
pm2 save
cp ~/.pm2/dump.pm2 "$BACKUP_DIR/" 2>/dev/null || echo "⚠️  PM2 dump not found"

# Create archive
echo "📦 Creating archive..."
tar -czf "$BACKUP_DIR.tar.gz" -C "$(dirname "$BACKUP_DIR")" "$(basename "$BACKUP_DIR")"
rm -rf "$BACKUP_DIR"

echo "✅ Backup completed: $BACKUP_DIR.tar.gz"

# Cleanup old backups (keep last 7)
echo "🧹 Cleaning up old backups..."
ls -t backups/*.tar.gz | tail -n +8 | xargs rm -f 2>/dev/null || true

echo "💾 Backup process finished"
`;
