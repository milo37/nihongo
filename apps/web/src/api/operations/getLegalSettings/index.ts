import { safeGet } from '@nihongo/browser/api/http'
import { legalRuntimeSettingsSchema } from '@api/operations/getLegalSettings/schema'
import type { LegalRuntimeSettings } from '@api/operations/getLegalSettings/schema'

/**
 * The deploy serves this file next to the web files (#705), so the real values
 * live outside the repository and the image. The image is the same for
 * STAGING and PRODUCTION.
 */
export const LEGAL_SETTINGS_PATH = '/legal-settings.json'

const requestLegalSettings = safeGet(legalRuntimeSettingsSchema)

// Same origin as the page, not under the API base.
export const getLegalSettings = (): Promise<LegalRuntimeSettings> =>
  requestLegalSettings(LEGAL_SETTINGS_PATH, undefined, { baseURL: '' })
