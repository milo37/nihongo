const adminErrorKeys = {
  AUTHENTICATION_REQUIRED: 'errors.authenticationRequired',
  AUTH_SESSION_EXPIRED: 'errors.sessionExpired',
  ADMIN_REQUIRED: 'errors.adminRequired',
  FORBIDDEN: 'errors.forbidden',
  FRESH_ASSURANCE_REQUIRED: 'errors.freshAssuranceRequired',
  VERSION_CONFLICT: 'errors.versionConflict',
  INVALID_STATE_TRANSITION: 'errors.invalidState',
  INVALID_ID: 'errors.invalidId',
  INVALID_REQUEST: 'errors.invalidRequest',
  VALIDATION_ERROR: 'errors.validation',
  RESOURCE_NOT_FOUND: 'errors.notFound',
  RATE_LIMITED: 'errors.rateLimited',
  INTERNAL_SERVER_ERROR: 'errors.server',
  SERVICE_UNAVAILABLE: 'errors.unavailable'
} as const

export const getAdminErrorKey = (error: unknown) => {
  if (!error || typeof error !== 'object') return 'errors.generic'
  if ('isOffline' in error && error.isOffline === true) return 'errors.offline'
  if (
    'code' in error &&
    typeof error.code === 'string' &&
    Object.hasOwn(adminErrorKeys, error.code)
  )
    return adminErrorKeys[error.code as keyof typeof adminErrorKeys]
  return 'errors.generic'
}

export const getAdminRetryAfterSeconds = (error: unknown): number | null => {
  if (!error || typeof error !== 'object' || !('retryAfterMs' in error))
    return null
  const value = error.retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.ceil(value / 1000))
    : null
}

export const adminReportOutcomeKey = {
  RESOLVED: 'enums.reportOutcomes.RESOLVED',
  DISMISSED: 'enums.reportOutcomes.DISMISSED'
} as const
