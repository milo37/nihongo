import type {
  GuestLimitDetails,
  StableErrorCode
} from '@nihongo/contracts/common/error'
import type {
  AdminExecutionDisposition,
  AdminInternalFailureReason
} from '@nihongo/contracts/admin/content-operations'

interface ApplicationErrorOptions {
  code: StableErrorCode
  message: string
  retryable: boolean
  fieldErrors?: Record<string, string[]>
  details?: GuestLimitDetails
  location?: `/api/v1/study-sessions/${string}/result`
  retryAfterSeconds?: number
  adminDisposition?: AdminExecutionDisposition
  adminInternalReason?: AdminInternalFailureReason
  cause?: unknown
}

export class ApplicationError extends Error {
  readonly code: StableErrorCode
  readonly retryable: boolean
  readonly fieldErrors?: Record<string, string[]>
  readonly details?: GuestLimitDetails
  readonly location?: `/api/v1/study-sessions/${string}/result`
  readonly retryAfterSeconds?: number
  readonly adminDisposition?: AdminExecutionDisposition
  readonly adminInternalReason?: AdminInternalFailureReason

  constructor(options: ApplicationErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'ApplicationError'
    this.code = options.code
    this.retryable = options.retryable

    if (options.fieldErrors) {
      this.fieldErrors = options.fieldErrors
    }
    if (options.details) {
      this.details = options.details
    }
    if (options.location) {
      this.location = options.location
    }
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds
    }
    if (options.adminDisposition !== undefined) {
      this.adminDisposition = options.adminDisposition
    }
    if (options.adminInternalReason !== undefined) {
      this.adminInternalReason = options.adminInternalReason
    }
  }
}
