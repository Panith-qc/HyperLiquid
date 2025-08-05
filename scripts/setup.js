const setupScript = `#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Setting up Hyperliquid Trading Bot...\n');

// Create necessary directories
const directories = [
  'logs',
  'logs/trading',
  'logs/system',
  'logs/audit',
  'data',
  'data/historical',
  'data/backtests',
  'data/exports',
];

directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(\`✅ Created directory: \${dir}\`);
  }
});

// Copy .env.example to .env if it doesn't exist
if (!fs.existsSync('.env')) {
  if (fs.existsSync('.env.example')) {
    fs.copyFileSync('.env.example', '.env');
    console.log('✅ Created .env file from .env.example');
    console.log('⚠️  Please update .env with your actual configuration');
  } else {
    console.log('❌ .env.example not found');
  }
}

// Install dependencies
console.log('\n📦 Installing dependencies...');
try {
  execSync('npm install', { stdio: 'inherit' });
  console.log('✅ Dependencies installed successfully');
} catch (error) {
  console.error('❌ Failed to install dependencies:', error.message);
  process.exit(1);
}

// Build TypeScript
console.log('\n🔨 Building TypeScript...');
try {
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ TypeScript build completed');
} catch (error) {
  console.error('❌ TypeScript build failed:', error.message);
  process.exit(1);
}

// Run tests
console.log('\n🧪 Running tests...');
try {
  execSync('npm test', { stdio: 'inherit' });
  console.log('✅ All tests passed');
} catch (error) {
  console.log('⚠️  Some tests failed, but setup continues...');
}

console.log('\n🎉 Setup completed successfully!');
console.log('\n📋 Next steps:');
console.log('1. Update .env with your Hyperliquid API credentials');
console.log('2. Review configuration settings');
console.log('3. Run: npm run dev (for development)');
console.log('4. Run: npm run start (for production)');
console.log('5. Open: http://localhost:3000 (dashboard)');
console.log('\n🔗 Useful commands:');
console.log('- npm run dev          # Start in development mode');
console.log('- npm run dashboard    # Start dashboard server');
console.log('- npm run test         # Run test suite');
console.log('- npm run deploy       # Deploy to production');
console.log('- npm run monitor      # Monitor with PM2');
`;