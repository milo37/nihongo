import { queryOptions } from '@tanstack/react-query'
import { getLegalSettings } from '@api/operations/getLegalSettings'
import type { LegalRuntimeSettings } from '@api/operations/getLegalSettings/schema'

const emptyLegalSettings: LegalRuntimeSettings = {
  contactEmail: '',
  privacyOfficer: ''
}

// Without the deploy file (STAGING, development) the page shows the fallback
// copy instead of an error.
const getLegalSettingsOrEmpty = () =>
  getLegalSettings().catch(() => emptyLegalSettings)

export const operationsQueries = {
  legalSettings: () =>
    queryOptions({
      queryKey: ['operations', 'legal-settings'] as const,
      queryFn: getLegalSettingsOrEmpty,
      staleTime: Infinity,
      retry: false
    })
} as const
