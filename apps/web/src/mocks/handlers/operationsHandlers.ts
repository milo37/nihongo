import { http, HttpResponse } from 'msw'
import { LEGAL_SETTINGS_PATH } from '@api/operations/getLegalSettings'

// No deploy file in development and tests: the legal pages show the fallback.
export const operationsHandlers = [
  http.get(LEGAL_SETTINGS_PATH, () => new HttpResponse(null, { status: 404 }))
]
