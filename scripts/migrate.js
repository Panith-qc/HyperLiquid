const migrateScript = `#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

console.log('🔄 Running database migrations...');

const dbPath = process.env.DATABASE_URL?.replace('sqlite:', '') || './data/trading.db';
const dbDir = path.dirname(dbPath);

// Create database directory if it doesn't exist
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Connect to database
const db = new sqlite3.Database(dbPath);

// Migration queries
const migrations = [
  // Create trades table
  \`CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    size REAL NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL,
    entry_time INTEGER NOT NULL,
    exit_time INTEGER,
    pnl REAL DEFAULT 0,
    fees REAL DEFAULT 0,
    rebates REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    strategy TEXT DEFAULT 'one_sided_quoting',
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )\`,
  
  // Create positions table
  \`CREATE TABLE IF NOT EXISTS positions (
    symbol TEXT PRIMARY KEY,
    side TEXT NOT NULL,
    size REAL NOT NULL,
    entry_price REAL NOT NULL,
    mark_price REAL NOT NULL,
    unrealized_pnl REAL DEFAULT 0,
    realized_pnl REAL DEFAULT 0,
    fees REAL DEFAULT 0,
    rebates REAL DEFAULT 0,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )\`,
  
  // Create risk_events table
  \`CREATE TABLE IF NOT EXISTS risk_events (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    level TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    symbol TEXT,
    value REAL,
    limit_value REAL,
    action TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )\`,
  
  // Create performance_snapshots table
  \`CREATE TABLE IF NOT EXISTS performance_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    total_value REAL NOT NULL,
    cash REAL NOT NULL,
    unrealized_pnl REAL DEFAULT 0,
    realized_pnl REAL DEFAULT 0,
    total_fees REAL DEFAULT 0,
    total_rebates REAL DEFAULT 0,
    daily_pnl REAL DEFAULT 0,
    drawdown REAL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )\`,
  
  // Create indices
  \`CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)\`,
  \`CREATE INDEX IF NOT EXISTS idx_trades_entry_time ON trades(entry_time)\`,
  \`CREATE INDEX IF NOT EXISTS idx_risk_events_timestamp ON risk_events(timestamp)\`,
  \`CREATE INDEX IF NOT EXISTS idx_performance_timestamp ON performance_snapshots(timestamp)\`,
];

// Run migrations
async function runMigrations() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      migrations.forEach((migration, index) => {
        db.run(migration, (err) => {
          if (err) {
            console.error(\`❌ Migration \${index + 1} failed:\`, err.message);
            reject(err);
          } else {
            console.log(\`✅ Migration \${index + 1} completed\`);
          }
        });
      });
      
      console.log('✅ All migrations completed successfully');
      resolve();
    });
  });
}

// Initialize configuration table
function initializeConfig() {
  const configTable = \`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  \`;
  
  db.run(configTable, (err) => {
    if (err) {
      console.error('❌ Failed to create config table:', err.message);
    } else {
      console.log('✅ Config table initialized');
      
      // Insert default configuration
      const defaultConfigs = [
        ['version', '1.0.0'],
        ['initialized_at', Date.now().toString()],
        ['last_migration', Date.now().toString()],
      ];
      
      defaultConfigs.forEach(([key, value]) => {
        db.run(
          'INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)',
          [key, value],
          (err) => {
            if (err) {
              console.error(\`❌ Failed to insert config \${key}:\`, err.message);
            }
          }
        );
      });
    }
  });
}

// Main execution
runMigrations()
  .then(() => {
    initializeConfig();
    console.log('\n🎉 Database setup completed successfully!');
    console.log(\`📍 Database location: \${dbPath}\`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
`;
