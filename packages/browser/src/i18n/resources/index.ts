import { jaCoreResources } from './ja'
import type { LocaleCatalog } from './ja'
import { jaAdminResources } from './ja-admin'
import { koResources } from './ko'

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

export { koResources }
