/**
 * Values the legal pages fill in (K2 #668). Put the real values here in a
 * small commit before the PRODUCTION build; an empty value shows the fallback
 * copy.
 */
export const legalSettings = {
  effectiveDate: '',
  contactEmail: '',
  privacyOfficer: ''
}

export type LegalSettings = Readonly<Record<keyof typeof legalSettings, string>>
