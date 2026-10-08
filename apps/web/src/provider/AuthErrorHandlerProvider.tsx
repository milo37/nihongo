import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import { isApiError } from '@api/config'
import { commitCanonicalAuth } from '@app/login/authSession'
import { subscribeApiError } from '@libs/errorBus'
import { getRouteLabelKey } from '@/i18n/routePresentation'
import { frontendErrorReporter } from '@/observability/frontendErrorReporter'

type BannerKind = 'error' | 'offline' | 'restored'
type BannerMessageKey =
  | 'banner.offline'
  | 'banner.restored'
  | 'banner.generic'
  | 'banner.network'
  | 'banner.response'
  | 'banner.validation'
  | 'banner.server'

const toStatusClass = (
  status: number | undefined
): '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | undefined => {
  if (status === undefined) return undefined
  if (status >= 100 && status < 200) return '1xx'
  if (status >= 200 && status < 300) return '2xx'
  if (status >= 300 && status < 400) return '3xx'
  if (status >= 400 && status < 500) return '4xx'
  return '5xx'
}

interface StatusBanner {
  kind: BannerKind
  messageKey: BannerMessageKey
}

const offlineBanner: StatusBanner = {
  kind: 'offline',
  messageKey: 'banner.offline'
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
  const { t } = useTranslation('errors')
  const { t: commonT } = useTranslation('common')
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
        messageKey: 'banner.restored'
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
        frontendErrorReporter.report({
          source: 'UNEXPECTED_API_ERROR',
          routeKey: getRouteLabelKey(location.pathname)
        })
        setBanner({
          kind: 'error',
          messageKey: 'banner.generic'
        })
        return
      }

      const isFreshAssuranceFlow =
        error.code === 'FRESH_ASSURANCE_REQUIRED' ||
        error.code === 'REAUTHENTICATION_FAILED'

      if (error.isAuthError && !isFreshAssuranceFlow) {
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

      if (isFreshAssuranceFlow) {
        return
      }

      // A valid ADMIN can receive object-level FORBIDDEN from a Phase 7
      // command. Keep the owning screen and its draft mounted so that the
      // command surface can render the error locally.
      if (error.isForbiddenError && error.code === 'FORBIDDEN') {
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
          messageKey: 'banner.network'
        })
        return
      }

      if (error.isResponseValidationError) {
        const statusClass = toStatusClass(error.status)
        frontendErrorReporter.report({
          source: 'API_RESPONSE_VALIDATION',
          routeKey: getRouteLabelKey(location.pathname),
          ...(error.requestId ? { requestId: error.requestId } : {}),
          ...(statusClass ? { statusClass } : {})
        })
        setBanner({
          kind: 'error',
          messageKey: 'banner.response'
        })
        return
      }

      if (error.isServerValidationError || error.isValidationError) {
        setBanner({
          kind: 'error',
          messageKey: 'banner.validation'
        })
        return
      }

      if (error.isServerError) {
        setBanner({
          kind: 'error',
          messageKey: 'banner.server'
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
      <span>{t(banner.messageKey)}</span>
      <button
        className={`min-h-11 shrink-0 rounded-lg px-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${closeButtonClasses[banner.kind]}`}
        type="button"
        onClick={() => setBanner(null)}
      >
        {commonT('actions.close')}
      </button>
    </div>
  )
}
