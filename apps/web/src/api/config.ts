import axios from 'axios'
import { z, type ZodType } from 'zod'

export interface ApiErrorFlags {
  isAuthError?: boolean
  isForbiddenError?: boolean
  isNotFoundError?: boolean
  isServerError?: boolean
  isNetworkError?: boolean
  isOffline?: boolean
  isValidationError?: boolean
  status?: number
}

export type AppApiError = Error & ApiErrorFlags

const API_TIMEOUT_MS = 10_000
const ERROR_FLAG_KEYS = new Set<keyof ApiErrorFlags>([
  'isAuthError',
  'isForbiddenError',
  'isNotFoundError',
  'isServerError',
  'isNetworkError',
  'isOffline',
  'isValidationError',
  'status'
])

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: API_TIMEOUT_MS
})

export const isApiError = (error: unknown): error is AppApiError => {
  if (!(error instanceof Error)) {
    return false
  }

  return Object.keys(error).some((key) =>
    ERROR_FLAG_KEYS.has(key as keyof ApiErrorFlags)
  )
}

const checkOfflineStatus = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false
  }

  return navigator.onLine === false
}

const withErrorFlags = (error: Error, flags: ApiErrorFlags): AppApiError =>
  Object.assign(error, flags)

apiClient.interceptors.request.use((config) => {
  if (!checkOfflineStatus()) {
    return config
  }

  return Promise.reject(
    withErrorFlags(
      new Error('오프라인 상태입니다. 네트워크 연결을 확인해주세요.'),
      {
        isNetworkError: true,
        isOffline: true
      }
    )
  )
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (checkOfflineStatus()) {
      const offlineError =
        error instanceof Error
          ? error
          : new Error('네트워크 오류가 발생했습니다.')

      return Promise.reject(
        withErrorFlags(offlineError, {
          isNetworkError: true,
          isOffline: true
        })
      )
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status

      return Promise.reject(
        withErrorFlags(error, {
          isAuthError: status === 401,
          isForbiddenError: status === 403,
          isNotFoundError: status === 404,
          isServerError: status !== undefined && status >= 500,
          isNetworkError: error.response === undefined,
          isOffline: false,
          isValidationError: status === 422,
          status
        })
      )
    }

    const normalizedError =
      error instanceof Error
        ? error
        : new Error('알 수 없는 오류가 발생했습니다.')

    return Promise.reject(normalizedError)
  }
)

type AsyncMethod<Arguments extends unknown[]> = (
  ...args: Arguments
) => Promise<unknown>

export const safeFactory =
  <Arguments extends unknown[]>(method: AsyncMethod<Arguments>) =>
  <Schema extends ZodType>(schema: Schema) =>
  async (...args: Arguments): Promise<z.output<Schema>> => {
    const rawData = await method(...args)
    const parsedData = schema.safeParse(rawData)

    if (!parsedData.success) {
      if (import.meta.env.DEV) {
        console.error('API response validation failed', parsedData.error)
      }

      throw withErrorFlags(
        new Error('응답 형식이 올바르지 않습니다.', {
          cause: parsedData.error
        }),
        {
          isValidationError: true,
          status: 422
        }
      )
    }

    return parsedData.data
  }
