import type { StableErrorCode } from '@nihongo/contracts/common/error'

interface ApplicationErrorOptions {
  code: StableErrorCode
  message: string
  retryable: boolean
  fieldErrors?: Record<string, string[]>
  retryAfterSeconds?: number
  cause?: unknown
}

export class ApplicationError extends Error {
  readonly code: StableErrorCode
  readonly retryable: boolean
  readonly fieldErrors?: Record<string, string[]>
  readonly retryAfterSeconds?: number

  constructor(options: ApplicationErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'ApplicationError'
    this.code = options.code
    this.retryable = options.retryable

    if (options.fieldErrors) {
      this.fieldErrors = options.fieldErrors
    }
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds
    }
  }
}
