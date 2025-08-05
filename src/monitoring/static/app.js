const dashboardJs = `
class TradingDashboard {
    constructor() {
        this.data = {};
        this.charts = {};
        this.refreshInterval = 5000; // 5 seconds
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initCharts();
        this.startDataRefresh();
        this.loadInitialData();
    }

    setupEventListeners() {
        document.getElementById('startBtn').addEventListener('click', () => {
            this.toggleStrategy('start');
        });

        document.getElementById('stopBtn').addEventListener('click', () => {
            this.toggleStrategy('stop');
        });

        document.getElementById('emergencyBtn').addEventListener('click', () => {
            this.triggerEmergencyStop();
        });
    }

    async toggleStrategy(action) {
        try {
            const response = await fetch('/api/strategy/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            
            const result = await response.json();
            if (result.success) {
                this.showNotification(\`Strategy \${action}ed successfully\`, 'success');
            }
        } catch (error) {
            this.showNotification('Failed to toggle strategy', 'error');
        }
    }

    async triggerEmergencyStop() {
        if (confirm('Are you sure you want to trigger emergency stop?')) {
            try {
                const response = await fetch('/api/emergency-stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'trigger' })
                });
                
                const result = await response.json();
                if (result.success) {
                    this.showNotification('Emergency stop triggered', 'warning');
                }
            } catch (error) {
                this.showNotification('Failed to trigger emergency stop', 'error');
            }
        }
    }

    async loadInitialData() {
        try {
            const response = await fetch('/api/metrics');
            this.data = await response.json();
            this.updateUI();
        } catch (error) {
            console.error('Failed to load initial data:', error);
        }
    }

    startDataRefresh() {
        setInterval(async () => {
            try {
                const response = await fetch('/api/metrics');
                this.data = await response.json();
                this.updateUI();
                this.updateCharts();
            } catch (error) {
                console.error('Failed to refresh data:', error);
                this.updateConnectionStatus(false);
            }
        }, this.refreshInterval);
    }

    updateUI() {
        this.updateConnectionStatus(true);
        this.updateStrategyStatus();
        this.updatePerformanceMetrics();
        this.updateRiskMetrics();
        this.updateSignals();
        this.updatePortfolio();
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        const statusDot = indicator.querySelector('.status-dot');
        
        if (connected) {
            statusText.textContent = 'Connected';
            statusDot.style.background = '#4CAF50';
            indicator.classList.remove('disconnected');
        } else {
            statusText.textContent = 'Disconnected';
            statusDot.style.background = '#f44336';
            indicator.classList.add('disconnected');
        }
    }

    updateStrategyStatus() {
        if (!this.data.strategy) return;

        document.getElementById('strategyStatus').textContent = 
            this.data.strategy.isRunning ? 'Running' : 'Stopped';
        document.getElementById('activeOrders').textContent = 
            this.data.strategy.activeOrders || 0;
        document.getElementById('openPositions').textContent = 
            this.data.strategy.positions || 0;
    }

    updatePerformanceMetrics() {
        if (!this.data.portfolio) return;

        const portfolio = this.data.portfolio;
        
        this.updatePnlElement('totalPnl', portfolio.netPnl);
        this.updatePnlElement('dailyPnl', this.data.risk?.metrics?.dailyPnl || 0);
        
        document.getElementById('totalRebates').textContent = 
            this.formatCurrency(portfolio.totalRebates || 0);
        document.getElementById('winRate').textContent = 
            this.formatPercent(this.data.risk?.metrics?.winRate || 0);
        document.getElementById('sharpeRatio').textContent = 
            (this.data.risk?.metrics?.sharpeRatio || 0).toFixed(2);
        document.getElementById('maxDrawdown').textContent = 
            this.formatPercent(this.data.risk?.metrics?.maxDrawdown || 0);
    }

    updateRiskMetrics() {
        if (!this.data.risk) return;

        const risk = this.data.risk;
        const riskStatus = document.getElementById('riskStatus');
        const riskIndicator = riskStatus.querySelector('.risk-indicator');
        
        // Update risk status
        riskIndicator.className = \`risk-indicator \${risk.status.toLowerCase()}\`;
        riskIndicator.querySelector('span:last-child').textContent = 
            \`Risk Status: \${risk.status}\`;

        document.getElementById('currentDrawdown').textContent = 
            this.formatPercent(risk.metrics?.currentDrawdown || 0);
        document.getElementById('dailyLoss').textContent = 
            this.formatCurrency(risk.metrics?.dailyLoss || 0);
        document.getElementById('totalExposure').textContent = 
            this.formatCurrency(risk.metrics?.totalExposure || 0);
    }

    updateSignals() {
        // This would be populated with real signal data
        const signalsContainer = document.getElementById('signalsContainer');
        signalsContainer.innerHTML = '<div class="signal-item"><span class="symbol">ETH</span><span class="direction neutral">NEUTRAL</span><span class="confidence">0%</span></div>';
    }

    updatePortfolio() {
        if (!this.data.portfolio) return;

        const portfolio = this.data.portfolio;
        
        document.getElementById('portfolioValue').textContent = 
            this.formatCurrency(portfolio.totalValue || 0);
        document.getElementById('cashBalance').textContent = 
            this.formatCurrency(portfolio.cash || 0);
        this.updatePnlElement('unrealizedPnl', portfolio.unrealizedPnl || 0);

        this.updatePositionsTable(this.data.positions || []);
    }

    updatePositionsTable(positions) {
        const container = document.getElementById('positionsTable');
        
        if (positions.length === 0) {
            container.innerHTML = '<p>No open positions</p>';
            return;
        }

        let tableHtml = \`
            <table class="positions-table">
                <thead>
                    <tr>
                        <th>Symbol</th>
                        <th>Side</th>
                        <th>Size</th>
                        <th>Entry Price</th>
                        <th>Mark Price</th>
                        <th>Unrealized P&L</th>
                    </tr>
                </thead>
                <tbody>
        \`;

        positions.forEach(position => {
            const pnlClass = position.unrealizedPnl >= 0 ? 'pnl-positive' : 'pnl-negative';
            tableHtml += \`
                <tr>
                    <td>\${position.symbol}</td>
                    <td>\${position.side}</td>
                    <td>\${position.size}</td>
                    <td>\${this.formatCurrency(position.entryPrice)}</td>
                    <td>\${this.formatCurrency(position.markPrice)}</td>
                    <td class="\${pnlClass}">\${this.formatCurrency(position.unrealizedPnl)}</td>
                </tr>
            \`;
        });

        tableHtml += '</tbody></table>';
        container.innerHTML = tableHtml;
    }

    updatePnlElement(elementId, value) {
        const element = document.getElementById(elementId);
        element.textContent = this.formatCurrency(value);
        element.className = value >= 0 ? 'pnl-positive' : 'pnl-negative';
    }

    initCharts() {
        const ctx = document.getElementById('equityChart').getContext('2d');
        this.charts.equity = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Portfolio Value',
                    data: [],
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    },
                    x: {
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    }
                }
            }
        });
    }

    updateCharts() {
        // Update equity chart with portfolio value over time
        if (this.data.portfolio) {
            const chart = this.charts.equity;
            const now = new Date();
            
            chart.data.labels.push(now.toLocaleTimeString());
            chart.data.datasets[0].data.push(this.data.portfolio.totalValue || 10000);
            
            // Keep only last 50 data points
            if (chart.data.labels.length > 50) {
                chart.data.labels.shift();
                chart.data.datasets[0].data.shift();
            }
            
            chart.update('none');
        }
    }

    formatCurrency(value) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value || 0);
    }

    formatPercent(value) {
        return \`\${(value || 0).toFixed(2)}%\`;
    }

    showNotification(message, type = 'info') {
        // Simple notification system
        const notification = document.createElement('div');
        notification.className = \`notification notification-\${type}\`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    new TradingDashboard();
});
`;

// Export the static files as strings for easy file creation
export const dashboardFiles = {
  'dashboard.html': dashboardHtml,
  'style.css': dashboardCss,
  'app.js': dashboardJs,
};
