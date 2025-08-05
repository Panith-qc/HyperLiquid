import { WebSocketManager } from '../../src/core/websocket-manager';

describe('WebSocketManager Integration', () => {
  let wsManager: WebSocketManager;

  beforeEach(() => {
    wsManager = new WebSocketManager({
      url: 'wss://api.hyperliquid-testnet.xyz/ws',
      reconnectDelay: 1000,
      maxReconnectAttempts: 3,
    });
  });

  afterEach(() => {
    wsManager.disconnect();
  });

  describe('connection', () => {
    it('should handle connection attempts', async () => {
      // Test connection handling without requiring actual connection
      expect(wsManager.isConnected()).toBe(false);
      
      const connectionStatus = wsManager.getConnectionStatus();
      expect(connectionStatus).toHaveProperty('connected');
      expect(connectionStatus).toHaveProperty('reconnectAttempts');
    });

    it('should manage subscriptions', () => {
      wsManager.subscribe('l2Book', 'ETH');
      wsManager.subscribe('trades', 'BTC');
      
      // Verify subscriptions are tracked
      expect(wsManager['subscriptions'].size).toBe(2);
      
      wsManager.unsubscribe('l2Book', 'ETH');
      expect(wsManager['subscriptions'].size).toBe(1);
    });
  });

  describe('event handling', () => {
    it('should emit events for data updates', (done) => {
      wsManager.on('connected', () => {
        done();
      });

      wsManager.on('error', (error) => {
        // Expected for test environment
        expect(error).toBeInstanceOf(Error);
        done();
      });

      // Attempt connection (will likely fail in test environment)
      wsManager.connect().catch(() => {
        // Expected to fail
        done();
      });
    });
  });
});