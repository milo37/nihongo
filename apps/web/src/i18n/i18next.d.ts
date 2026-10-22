import type { koResources } from '@/i18n/resources/ko'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof koResources
  }
}
