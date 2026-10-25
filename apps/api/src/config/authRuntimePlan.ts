import type { ApiEnvironment } from './env.js'

/** Authentication authority is independent of whether CMS routes are enabled. */
export const createAuthRuntimePlan = (environment: ApiEnvironment) => {
  const ownedAuth = Boolean(environment.AUTH_GATEWAY_DATABASE_URL)
  if (
    (environment.GOOGLE_CLIENT_ID || environment.APPLE_CLIENT_ID) &&
    !ownedAuth
  )
    throw new Error('SSO database authority is unavailable.')
  return {
    ownedAuth,
    migrationProfile: ownedAuth
      ? ('current' as const)
      : ('pre-phase7' as const),
    ...(ownedAuth
      ? {
          applicationRole: 'nihongo_app' as const,
          gatewayRole: 'nihongo_auth_gateway' as const
        }
      : {}),
    cmsEnabled: environment.ADMIN_CMS_MODE === 'technical'
  }
}
