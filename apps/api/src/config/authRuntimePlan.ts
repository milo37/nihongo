import type { ApiEnvironment } from './env.js'

/** Authentication authority is independent of whether CMS routes are enabled. */
export const createAuthRuntimePlan = (environment: ApiEnvironment) => {
  const ownedAuth = environment.AUTH_RUNTIME === 'owned'
  if (
    (environment.GOOGLE_CLIENT_ID || environment.APPLE_CLIENT_ID) &&
    !ownedAuth
  )
    throw new Error('SSO database authority is unavailable.')
  return {
    ownedAuth,
    migrationProfile: 'current' as const,
    ...(ownedAuth ? { applicationRole: 'nihongo_app' as const } : {}),
    cmsEnabled: environment.ADMIN_CMS_MODE === 'technical'
  }
}
