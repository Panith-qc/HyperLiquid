import { AxiosError } from 'axios';
import { logger } from '@/utils/logger';

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  retryable: boolean;
}

export class ErrorHandler {
  private retryDelays = [1000, 2000, 5000, 10000]; // Exponential backoff

  async handleApiError(error: AxiosError): Promise<never> {
    const apiError = this.mapAxiosError(error);
    logger.error('API Error', apiError);

    if (apiError.retryable) {
      // Implement retry logic if needed
      return this.retryRequest(error);
    }

    throw new Error(apiError.message);
  }

  private mapAxiosError(error: AxiosError): ApiError {
    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const data = error.response.data as any;

      if (status === 429) {
        return {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
          details: data,
          retryable: true,
        };
      }

      if (status === 401) {
        return {
          code: 'UNAUTHORIZED',
          message: 'Authentication failed',
          details: data,
          retryable: false,
        };
      }

      if (status === 403) {
        return {
          code: 'FORBIDDEN', 
          message: 'Insufficient permissions',
          details: data,
          retryable: false,
        };
      }

      if (status >= 500) {
        return {
          code: 'SERVER_ERROR',
          message: 'Server error occurred',
          details: data,
          retryable: true,
        };
      }

      return {
        code: 'API_ERROR',
        message: data?.message || 'API request failed',
        details: data,
        retryable: false,
      };
    }

    if (error.request) {
      // Request was made but no response received
      return {
        code: 'NETWORK_ERROR',
        message: 'Network error - no response received',
        details: error.message,
        retryable: true,
      };
    }

    // Request setup error
    return {
      code: 'REQUEST_ERROR',
      message: error.message || 'Request configuration error',
      details: error,
      retryable: false,
    };
  }

  private async retryRequest(error: AxiosError): Promise<never> {
    // Simplified retry logic - implement full retry mechanism as needed
    throw new Error('Request failed after retries');
  }
}