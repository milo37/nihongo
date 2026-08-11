import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import { isApiError } from '@api/config'
import { subscribeApiError } from '@libs/errorBus'
import { useAppStore } from '@store/index'

export const AuthErrorHandlerProvider = (): ReactElement | null => {
  const navigate = useNavigate()
  const location = useLocation()
  const setCurrentUser = useAppStore((state) => state.setCurrentUser)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    return subscribeApiError((error) => {
      if (!isApiError(error)) {
        setMessage('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }

      if (error.isAuthError) {
        setCurrentUser(null)
        const redirect = encodeURIComponent(
          `${location.pathname}${location.search}`
        )
        navigate(`/login?redirect=${redirect}`, { replace: true })
        return
      }

      if (error.isForbiddenError) {
        navigate('/forbidden', { replace: true })
        return
      }

      if (error.isOffline) {
        setMessage('오프라인 상태입니다. 네트워크 연결을 확인해주세요.')
        return
      }

      if (error.isNetworkError) {
        setMessage('네트워크 연결이 원활하지 않습니다. 다시 시도해 주세요.')
        return
      }

      if (error.isValidationError) {
        if (import.meta.env.DEV) {
          console.error('API response validation failed', error)
        }
        setMessage('응답 형식이 올바르지 않습니다.')
        return
      }

      if (error.isServerError) {
        setMessage(
          '서버 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        )
      }
    })
  }, [location.pathname, location.search, navigate, setCurrentUser])

  if (!message) {
    return null
  }

  return (
    <div
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-soft"
      role="status"
      aria-live="polite"
    >
      <span>{message}</span>
      <button
        className="min-h-11 shrink-0 rounded-lg px-3 font-semibold hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
        type="button"
        onClick={() => setMessage(null)}
      >
        닫기
      </button>
    </div>
  )
}
