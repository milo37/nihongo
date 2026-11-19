export interface AdminApiErrorPresentation {
  readonly code?: string
  readonly isOffline?: boolean
  readonly retryAfterMs?: number
}

export type AdminStableErrorCode =
  | 'ADMIN_REQUIRED'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTH_SESSION_EXPIRED'
  | 'DUPLICATE_QUESTION_CONTENT'
  | 'FORBIDDEN'
  | 'FRESH_ASSURANCE_REQUIRED'
  | 'IMPORT_IDENTITY_CONFLICT'
  | 'IMPORT_VALIDATION_FAILED'
  | 'INTERNAL_SERVER_ERROR'
  | 'INVALID_ID'
  | 'INVALID_JSON'
  | 'INVALID_REQUEST'
  | 'INVALID_STATE_TRANSITION'
  | 'QUESTION_REPORT_DUPLICATE'
  | 'QUESTION_VERSION_IMMUTABLE'
  | 'RATE_LIMITED'
  | 'REAUTHENTICATION_FAILED'
  | 'REQUEST_TOO_LARGE'
  | 'RESOURCE_NOT_FOUND'
  | 'SEPARATION_OF_DUTIES_VIOLATION'
  | 'SERVICE_UNAVAILABLE'
  | 'UNTRUSTED_ORIGIN'
  | 'VALIDATION_ERROR'
  | 'VERSION_CONFLICT'

export const adminApiErrorKeyByCode = {
  AUTHENTICATION_REQUIRED: 'errors.authenticationRequired',
  AUTH_SESSION_EXPIRED: 'errors.sessionExpired',
  ADMIN_REQUIRED: 'errors.adminRequired',
  FORBIDDEN: 'errors.forbidden',
  FRESH_ASSURANCE_REQUIRED: 'errors.freshAssuranceRequired',
  INVALID_ID: 'errors.invalidId',
  INVALID_JSON: 'errors.invalidRequest',
  INVALID_REQUEST: 'errors.invalidRequest',
  REQUEST_TOO_LARGE: 'errors.requestTooLarge',
  VALIDATION_ERROR: 'errors.validation',
  RESOURCE_NOT_FOUND: 'errors.notFound',
  VERSION_CONFLICT: 'errors.versionConflict',
  QUESTION_VERSION_IMMUTABLE: 'errors.questionVersionImmutable',
  INVALID_STATE_TRANSITION: 'errors.invalidState',
  SEPARATION_OF_DUTIES_VIOLATION: 'errors.separationOfDuties',
  DUPLICATE_QUESTION_CONTENT: 'errors.duplicateQuestionContent',
  UNTRUSTED_ORIGIN: 'errors.untrustedOrigin',
  RATE_LIMITED: 'errors.rateLimited',
  INTERNAL_SERVER_ERROR: 'errors.server',
  SERVICE_UNAVAILABLE: 'errors.unavailable',
  QUESTION_REPORT_DUPLICATE: 'errors.reportDuplicate',
  IMPORT_IDENTITY_CONFLICT: 'errors.importIdentityConflict',
  IMPORT_VALIDATION_FAILED: 'errors.importValidationFailed',
  REAUTHENTICATION_FAILED: 'errors.reauthenticationFailed'
} as const satisfies Record<AdminStableErrorCode, string>

export type AdminErrorKey =
  | (typeof adminApiErrorKeyByCode)[keyof typeof adminApiErrorKeyByCode]
  | 'errors.offline'
  | 'errors.generic'

export const getAdminApiErrorKey = (
  error: AdminApiErrorPresentation | null | undefined,
  fallback: AdminErrorKey = 'errors.generic'
): AdminErrorKey => {
  if (!error) return fallback
  if (error.isOffline) return 'errors.offline'
  if (error.code && error.code in adminApiErrorKeyByCode) {
    return adminApiErrorKeyByCode[
      error.code as keyof typeof adminApiErrorKeyByCode
    ]
  }
  return fallback
}

export const getAdminRetryAfterSeconds = (
  error: AdminApiErrorPresentation | null | undefined
): number | null =>
  error?.retryAfterMs ? Math.max(1, Math.ceil(error.retryAfterMs / 1000)) : null

export const hasAdminFieldError = (
  messages: readonly string[] | undefined
): boolean => Boolean(messages?.length)
