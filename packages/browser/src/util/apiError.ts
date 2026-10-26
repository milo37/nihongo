export const isNotFoundApiError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    'isNotFoundError' in error &&
    error.isNotFoundError === true
  )
}
