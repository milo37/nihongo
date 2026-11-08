import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

type GuestActionOptions = {
  /** On a session or result screen: signing in does not carry it over. */
  sessionNotKept?: boolean
}

/**
 * For a member-only button pressed by a guest (U4 R3): shows one info toast
 * with [로그인] and returns true, so the caller leaves its state unchanged.
 * Nothing moves on its own.
 */
export const useGuestAction = (): ((
  title: string,
  options?: GuestActionOptions
) => boolean) => {
  const { t } = useTranslation('auth')
  const { role } = useAuth()
  const { addToast } = useToast()
  const navigate = useAppNavigate()
  const location = useLocation()
  const here = `${location.pathname}${location.search}`

  return useCallback(
    (title, { sessionNotKept = false } = {}) => {
      if (role !== 'GUEST') return false
      // A guest result is gone after sign-in, so come back to setup.
      const redirect = sessionNotKept ? '/practice' : here
      addToast({
        key: 'guest-action',
        title,
        ...(sessionNotKept
          ? { description: t('guestToast.sessionNotKept') }
          : {}),
        action: {
          label: t('guestToast.login'),
          onClick: () =>
            navigate(`/login?redirect=${encodeURIComponent(redirect)}`)
        }
      })
      return true
    },
    [addToast, here, navigate, role, t]
  )
}
