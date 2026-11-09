import { jaCoreResources } from './ja'
import type { LocaleCatalog } from './ja'
import { jaAdminResources } from './ja-admin'
import { koCoreResources } from './ko'
import { koAdminResources } from './ko-admin'

// Whole catalogs in the original key order; the app loads the admin part on
// demand (config.ts), these are for checks and tests.
const { errors: koErrors, a11y: koA11y, ...koNamespaces } = koCoreResources
export const koResources = {
  ...koNamespaces,
  admin: koAdminResources,
  errors: koErrors,
  a11y: koA11y
} as const

const { errors, a11y, ...jaNamespaces } = jaCoreResources
export const jaResources = {
  ...jaNamespaces,
  admin: jaAdminResources,
  errors,
  a11y
} as const satisfies LocaleCatalog<typeof koResources>

export const i18nResources = {
  ko: koResources,
  ja: jaResources
} as const

export { jaAdminLearnerResources } from './ja-admin-learner'
export { koAdminLearnerResources } from './ko-admin-learner'
