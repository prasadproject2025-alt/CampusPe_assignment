import { logger } from '../logger';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (error: any) => boolean;
}

export class RetryHandler {
  public static async executeWithRetry<T>(
    operationName: string,
    operation: (attempt: number) => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 5000;

    let attempt = 1;
    while (true) {
      try {
        return await operation(attempt);
      } catch (error: any) {
        const isTransient = options.retryOn ? options.retryOn(error) : RetryHandler.isTransientError(error);

        if (attempt >= maxRetries || !isTransient) {
          logger.error(`Operation [${operationName}] failed permanently after ${attempt} attempts: ${error.message}`);
          throw error;
        }

        // Exponential backoff with jitter
        const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * (baseDelayMs * 0.5);
        const delayMs = Math.min(exponentialDelay + jitter, maxDelayMs);

        logger.warn(`Operation [${operationName}] failed on attempt ${attempt}/${maxRetries} (${error.message}). Retrying in ${Math.round(delayMs)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        attempt++;
      }
    }
  }

  public static isTransientError(error: any): boolean {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('network') ||
      msg.includes('transient') ||
      msg.includes('server message') ||
      msg.includes('internal server error') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('target closed') ||
      msg.includes('detached from the dom') ||
      msg.includes('execution context was destroyed')
    );
  }
}
