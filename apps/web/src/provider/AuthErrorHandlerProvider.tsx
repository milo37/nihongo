import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import { isApiError } from '@api/config'
import { commitCanonicalAuth } from '@app/login/authSession'
import { subscribeApiError } from '@libs/errorBus'

type BannerKind = 'error' | 'offline' | 'restored'

interface StatusBanner {
  kind: BannerKind
  message: string
}

const offlineBanner: StatusBanner = {
  kind: 'offline',
  message: '오프라인 상태입니다. 네트워크 연결을 확인해 주세요.'
}

const getInitialBanner = (): StatusBanner | null => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return offlineBanner
  }

  return null
}

const bannerClasses: Record<BannerKind, string> = {
  error: 'border-red-200 bg-red-50 text-red-900',
  offline: 'border-amber-200 bg-amber-50 text-amber-950',
  restored: 'border-emerald-200 bg-emerald-50 text-emerald-950'
}

const closeButtonClasses: Record<BannerKind, string> = {
  error: 'hover:bg-red-100 focus-visible:outline-red-700',
  offline: 'hover:bg-amber-100 focus-visible:outline-amber-700',
  restored: 'hover:bg-emerald-100 focus-visible:outline-emerald-700'
}

export const AuthErrorHandlerProvider = (): ReactElement | null => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [banner, setBanner] = useState<StatusBanner | null>(getInitialBanner)
  const isOnlineRef = useRef(
    typeof navigator === 'undefined' || navigator.onLine !== false
  )

  useEffect(() => {
    const handleOffline = (): void => {
      if (!isOnlineRef.current) {
        return
      }

      isOnlineRef.current = false
      setBanner(offlineBanner)
    }
    const handleOnline = (): void => {
      if (isOnlineRef.current) {
        return
      }

      isOnlineRef.current = true
      setBanner({
        kind: 'restored',
        message:
          '네트워크 연결이 복구된 것으로 감지했습니다. 필요한 요청을 다시 시도해 주세요.'
      })
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  useEffect(() => {
    return subscribeApiError((error) => {
      if (!isApiError(error)) {
        setBanner({
          kind: 'error',
          message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        })
        return
      }

      if (error.isAuthError) {
        const redirect = encodeURIComponent(
          `${location.pathname}${location.search}`
        )
        void commitCanonicalAuth(queryClient, null, {
          forceClear: true,
          forcePracticeReset: true
        }).then(({ applied }) => {
          if (applied) {
            navigate(`/login?redirect=${redirect}`, { replace: true })
          }
        })
        return
      }

      if (error.isForbiddenError) {
        navigate('/forbidden', { replace: true })
        return
      }

      if (error.isOffline) {
        isOnlineRef.current = false
        setBanner(offlineBanner)
        return
      }

      if (error.isNetworkError) {
        setBanner({
          kind: 'error',
          message: '네트워크 연결이 원활하지 않습니다. 다시 시도해 주세요.'
        })
        return
      }

      if (error.isValidationError) {
        if (import.meta.env.DEV) {
          console.error('API response validation failed', error)
        }
        setBanner({
          kind: 'error',
          message: '응답 형식이 올바르지 않습니다. 다시 시도해 주세요.'
        })
        return
      }

      if (error.isServerError) {
        setBanner({
          kind: 'error',
          message:
            '서버 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        })
      }
    })
  }, [location.pathname, location.search, navigate, queryClient])

  if (!banner) {
    return null
  }

  return (
    <div
      className={`fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm shadow-soft ${bannerClasses[banner.kind]}`}
      role="status"
      aria-live="polite"
      data-kind={banner.kind}
    >
      <span>{banner.message}</span>
      <button
        className={`min-h-11 shrink-0 rounded-lg px-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${closeButtonClasses[banner.kind]}`}
        type="button"
        onClick={() => setBanner(null)}
      >
        닫기
      </button>
    </div>
  )
}
