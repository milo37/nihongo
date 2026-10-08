import type { StableErrorCode } from '@nihongo/contracts/common/error'
import type {
  Phase7ExecutionDisposition,
  Phase7InternalFailureReason
} from '@nihongo/contracts/admin/phase7'

interface ApplicationErrorOptions {
  code: StableErrorCode
  message: string
  retryable: boolean
  fieldErrors?: Record<string, string[]>
  location?: `/api/v1/study-sessions/${string}/result`
  retryAfterSeconds?: number
  phase7Disposition?: Phase7ExecutionDisposition
  phase7InternalReason?: Phase7InternalFailureReason
  cause?: unknown
}

export class ApplicationError extends Error {
  readonly code: StableErrorCode
  readonly retryable: boolean
  readonly fieldErrors?: Record<string, string[]>
  readonly location?: `/api/v1/study-sessions/${string}/result`
  readonly retryAfterSeconds?: number
  readonly phase7Disposition?: Phase7ExecutionDisposition
  readonly phase7InternalReason?: Phase7InternalFailureReason

  constructor(options: ApplicationErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'ApplicationError'
    this.code = options.code
    this.retryable = options.retryable

    if (options.fieldErrors) {
      this.fieldErrors = options.fieldErrors
    }
    if (options.location) {
      this.location = options.location
    }
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds
    }
    if (options.phase7Disposition !== undefined) {
      this.phase7Disposition = options.phase7Disposition
    }
    if (options.phase7InternalReason !== undefined) {
      this.phase7InternalReason = options.phase7InternalReason
    }
  }
}
