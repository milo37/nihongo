import { adminReportsResources } from '@/i18n/resources/adminReports'
import { jaResources } from '@/i18n/resources/ja'
import { koResources } from '@/i18n/resources/ko'

export const i18nResources = {
  ko: { ...koResources, adminReports: adminReportsResources.ko },
  ja: { ...jaResources, adminReports: adminReportsResources.ja }
} as const

export { jaResources, koResources }
