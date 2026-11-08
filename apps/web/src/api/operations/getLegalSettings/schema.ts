import { z } from 'zod'

// Missing, non-text or overlong values fall back to '' so the page shows the
// fallback copy instead of an error.
const settingValue = z.string().trim().max(200).catch('')

export const legalRuntimeSettingsSchema = z
  .object({
    contactEmail: settingValue.default(''),
    privacyOfficer: settingValue.default('')
  })
  .catch({ contactEmail: '', privacyOfficer: '' })

export type LegalRuntimeSettings = z.infer<typeof legalRuntimeSettingsSchema>
