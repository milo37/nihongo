import { jaCoreResources } from '@/i18n/resources/ja'
import type { LocaleCatalog } from '@/i18n/resources/ja'
import { jaAdminResources } from '@/i18n/resources/ja-admin'
import { koResources } from '@/i18n/resources/ko'

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
