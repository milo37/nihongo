import type { ApiEnvironment } from './env.js'

/** Authentication authority is independent of whether CMS routes are enabled. */
export const createAuthRuntimePlan = (environment: ApiEnvironment) => ({
  migrationProfile: 'current' as const,
  applicationRole: 'nihongo_app' as const,
  cmsEnabled: environment.ADMIN_CMS_MODE === 'technical'
})
