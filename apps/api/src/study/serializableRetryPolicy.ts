import { randomInt } from 'node:crypto'

/** Shared by study draft save and study submission Serializable transactions. */
export const SERIALIZABLE_MAX_ATTEMPTS = 5
export const SERIALIZABLE_RETRY_BASE_DELAY_MS = 10
export const SERIALIZABLE_RETRY_JITTER_MAX_MS = 5

/**
 * Wait before the next attempt after `attempt` failed: 10, 20, 40, 80 ms plus
 * jitter. A slow concurrent writer gets about 150 ms before the request
 * reports SERVICE_UNAVAILABLE (#395).
 */
export const getSerializableRetryDelayMs = (
  attempt: number,
  jitterMs: number
): number => SERIALIZABLE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + jitterMs

export const createSerializableRetryJitterMs = (): number =>
  randomInt(0, SERIALIZABLE_RETRY_JITTER_MAX_MS + 1)
