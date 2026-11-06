/**
 * Values the legal pages fill in (K2 #668), set per release build. An empty
 * value shows the fallback copy (STAGING before launch).
 */
const readSetting = (value: string | undefined): string => value?.trim() ?? ''

export const legalSettings = {
  effectiveDate: readSetting(import.meta.env.VITE_LEGAL_EFFECTIVE_DATE),
  contactEmail: readSetting(import.meta.env.VITE_CONTACT_EMAIL),
  privacyOfficer: readSetting(import.meta.env.VITE_PRIVACY_OFFICER)
} as const

export type LegalSettings = typeof legalSettings
