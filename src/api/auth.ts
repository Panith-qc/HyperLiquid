import crypto from 'crypto';
import { logger } from '@/utils/logger';

export class AuthManager {
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  getAuthHeaders(requestConfig: any): Record<string, string> {
    const timestamp = Date.now().toString();
    const signature = this.createSignature(requestConfig, timestamp);
    
    return {
      'HX-API-KEY': this.config.apiKey,
      'HX-TIMESTAMP': timestamp,
      'HX-SIGNATURE': signature,
    };
  }

  signOrder(orderData: any): string {
    const message = JSON.stringify(orderData);
    return this.sign(message);
  }

  signCancel(cancelData: any): string {
    const message = JSON.stringify(cancelData);
    return this.sign(message);
  }

  signCancelAll(symbol: string): string {
    const message = JSON.stringify({ symbol, type: 'cancelAll' });
    return this.sign(message);
  }

  private createSignature(requestConfig: any, timestamp: string): string {
    const method = requestConfig.method?.toUpperCase() || 'GET';
    const path = requestConfig.url || '';
    const body = requestConfig.data ? JSON.stringify(requestConfig.data) : '';
    
    const message = `${timestamp}${method}${path}${body}`;
    return this.sign(message);
  }

  private sign(message: string): string {
    try {
      return crypto
        .createHmac('sha256', this.config.secret)
        .update(message)
        .digest('hex');
    } catch (error) {
      logger.error('Signature creation failed', error);
      throw new Error('Failed to create signature');
    }
  }

  verifySignature(signature: string, message: string): boolean {
    const expectedSignature = this.sign(message);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }
}