module.exports = {
  apps: [{
    name: 'hyperliquid-bot',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: 'logs/combined.log',
    out_file: 'logs/out.log',
    error_file: 'logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s',
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }, {
    name: 'dashboard-server',
    script: 'dist/dashboard-server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      DASHBOARD_PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      DASHBOARD_PORT: 3000
    },
    log_file: 'logs/dashboard.log',
    autorestart: true,
    restart_delay: 3000
  }]
};