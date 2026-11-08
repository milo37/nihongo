/**
 * Values the legal pages fill in (K2 #668). The effective date is set here in
 * a commit before the PRODUCTION build. The contact email and the privacy
 * officer come from the deploy at run time (#705), never from the repository.
 * An empty value shows the fallback copy.
 */
export const legalEffectiveDate = ''

export type LegalSettings = Readonly<{
  effectiveDate: string
  contactEmail: string
  privacyOfficer: string
}>
