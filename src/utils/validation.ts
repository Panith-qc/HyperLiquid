import Joi from 'joi';
import { Decimal } from 'decimal.js';

export class ValidationUtils {
  /**
   * Validate trading symbol
   */
  static validateSymbol(symbol: string): boolean {
    const symbolSchema = Joi.string().alphanum().min(2).max(10).required();
    const { error } = symbolSchema.validate(symbol);
    return !error;
  }

  /**
   * Validate decimal value
   */
  static validateDecimal(value: any): boolean {
    try {
      new Decimal(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate price
   */
  static validatePrice(price: Decimal): boolean {
    return price.greaterThan(0) && price.isFinite();
  }

  /**
   * Validate size
   */
  static validateSize(size: Decimal): boolean {
    return size.greaterThan(0) && size.isFinite();
  }

  /**
   * Validate percentage
   */
  static validatePercentage(percent: Decimal): boolean {
    return percent.greaterThanOrEqualTo(0) && percent.lessThanOrEqualTo(100);
  }

  /**
   * Validate confidence score
   */
  static validateConfidence(confidence: Decimal): boolean {
    return confidence.greaterThanOrEqualTo(0) && confidence.lessThanOrEqualTo(1);
  }

  /**
   * Sanitize input string
   */
  static sanitizeString(input: string): string {
    return input.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  }

  /**
   * Validate configuration
   */
  static validateConfig(config: any): { isValid: boolean; errors: string[] } {
    const schema = Joi.object({
      trading: Joi.object({
        mode: Joi.string().valid('testnet', 'mainnet').required(),
        symbols: Joi.array().items(Joi.string()).min(1).required(),
        maxPositionSize: Joi.number().positive().required(),
        baseOrderSize: Joi.number().positive().required(),
        confidenceThreshold: Joi.number().min(0).max(1).required(),
        targetFillRate: Joi.number().min(0).max(1).required(),
        aggressivenessFactor: Joi.number().min(0).max(1).required(),
      }).required(),
      risk: Joi.object({
        maxDailyLoss: Joi.number().positive().required(),
        maxDrawdownPercent: Joi.number().positive().max(100).required(),
        positionTimeoutMinutes: Joi.number().positive().required(),
        riskCheckIntervalMs: Joi.number().positive().required(),
        emergencyStopLossPercent: Joi.number().positive().max(100).required(),
      }).required()
    });

    const { error } = schema.validate(config);
    if (error) {
      return {
        isValid: false,
        errors: error.details.map((detail: any) => detail.message)
      };
    }

    return { isValid: true, errors: [] };
  }
}