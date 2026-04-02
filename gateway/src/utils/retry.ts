import { logger } from './logger';

/**
 * Retry a function with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelay?: number; label?: string } = {},
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, label = 'operation' } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
        error: error instanceof Error ? error.message : error,
      });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}
