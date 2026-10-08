import { isApiError } from '@api/config'

export const isNotFoundApiError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    'isNotFoundError' in error &&
    error.isNotFoundError === true
  )
}

export const isAuthenticationBoundaryApiError = (error: unknown): boolean =>
  isApiError(error) && (error.status === 401 || error.status === 404)

export const isOfflineApiError = (error: unknown): boolean =>
  isApiError(error) && error.isOffline === true

export const isNoEligibleQuestionsApiError = (error: unknown): boolean =>
  isApiError(error) && error.code === 'NO_ELIGIBLE_QUESTIONS'

export const isQuestionNotAvailableApiError = (error: unknown): boolean =>
  isApiError(error) && error.code === 'QUESTION_NOT_AVAILABLE'

export const isStudyResultNotReadyApiError = (error: unknown): boolean =>
  isApiError(error) && error.code === 'STUDY_RESULT_NOT_READY'

export interface Phase7UiApiError extends Error {
  readonly code?: string
  readonly fieldErrors?: Record<string, string[]>
  readonly isOffline?: boolean
  readonly requestId?: string
  readonly retryAfterMs?: number
  readonly serverMessage?: string
  readonly status?: number
}

export const isPhase7UiApiError = (error: unknown): error is Phase7UiApiError =>
  error instanceof Error &&
  ('code' in error ||
    'fieldErrors' in error ||
    'isOffline' in error ||
    'requestId' in error ||
    'retryAfterMs' in error ||
    'serverMessage' in error ||
    'status' in error)
