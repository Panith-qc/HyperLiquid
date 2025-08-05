import moment from 'moment';

export class TimeUtils {
  /**
   * Get current timestamp in milliseconds
   */
  static now(): number {
    return Date.now();
  }

  /**
   * Convert timestamp to ISO string
   */
  static toISOString(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }

  /**
   * Get start of day timestamp
   */
  static startOfDay(timestamp?: number): number {
    return moment(timestamp).startOf('day').valueOf();
  }

  /**
   * Get end of day timestamp
   */
  static endOfDay(timestamp?: number): number {
    return moment(timestamp).endOf('day').valueOf();
  }

  /**
   * Add time to timestamp
   */
  static addTime(timestamp: number, amount: number, unit: moment.unitOfTime.DurationConstructor): number {
    return moment(timestamp).add(amount, unit).valueOf();
  }

  /**
   * Subtract time from timestamp
   */
  static subtractTime(timestamp: number, amount: number, unit: moment.unitOfTime.DurationConstructor): number {
    return moment(timestamp).subtract(amount, unit).valueOf();
  }

  /**
   * Format timestamp for display
   */
  static formatDisplay(timestamp: number): string {
    return moment(timestamp).format('YYYY-MM-DD HH:mm:ss');
  }

  /**
   * Get time difference in milliseconds
   */
  static diff(timestamp1: number, timestamp2: number): number {
    return Math.abs(timestamp1 - timestamp2);
  }

  /**
   * Check if timestamp is within trading hours
   */
  static isMarketHours(timestamp: number): boolean {
    // Crypto markets are 24/7, but you can implement custom logic
    return true;
  }

  /**
   * Get next market open
   */
  static nextMarketOpen(timestamp?: number): number {
    // For crypto, market is always open
    return timestamp || this.now();
  }

  /**
   * Sleep for specified milliseconds
   */
  static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}