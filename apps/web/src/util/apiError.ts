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
