import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'

type ApiErrorListener = (error: unknown) => void

const errorListeners = new Set<ApiErrorListener>()

export const emitApiError = (error: unknown): void => {
  if (isAuthTransitionSupersededError(error)) {
    return
  }

  for (const listener of errorListeners) {
    listener(error)
  }
}

export const subscribeApiError = (listener: ApiErrorListener): (() => void) => {
  errorListeners.add(listener)
  return () => {
    errorListeners.delete(listener)
  }
}
