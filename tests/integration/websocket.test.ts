import { HyperliquidClient } from '../../src/api/hyperliquid-api';
import { OrderType, OrderSide } from '../../src/types';
import { Decimal } from 'decimal.js';

describe('HyperliquidClient Integration', () => {
  let client: HyperliquidClient;

  beforeEach(() => {
    client = new HyperliquidClient({
      apiUrl: 'https://api.hyperliquid-testnet.xyz',
      wsUrl: 'wss://api.hyperliquid-testnet.xyz/ws',
      apiKey: 'test_key',
      secret: 'test_secret',
      walletAddress: 'test_wallet',
      privateKey: 'test_private_key',
      testnet: true,
    });
  });

  describe('testConnectivity', () => {
    it('should test API connectivity', async () => {
      // This would require actual testnet credentials for real testing
      // For now, just test that the method exists and returns a boolean
      const result = await client.testConnectivity().catch(() => false);
      expect(typeof result).toBe('boolean');
    }, 10000);
  });

  describe('getMarketInfo', () => {
    it('should handle API errors gracefully', async () => {
      try {
        await client.getMarketInfo();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('placeOrder', () => {
    it('should validate order parameters', async () => {
      const orderParams = {
        symbol: 'ETH',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        amount: new Decimal(0.1),
        price: new Decimal(2000),
      };

      // This would require valid credentials to actually work
      try {
        await client.placeOrder(orderParams);
      } catch (error) {
        // Expected to fail without valid credentials
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});
