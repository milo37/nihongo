import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ReauthButton } from '@nihongo/browser/app/reauth/components/ReauthButton'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { REAUTH_STATUS_ID } from '@nihongo/browser/app/reauth/components/ReauthReturnNotice'
import { useAdminReauth } from '@app/admin/reauth/useAdminReauth'
import { useReauthClock } from '@app/admin/reauth/useReauthClock'
import type { ReauthClock } from '@app/admin/reauth/useReauthClock'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

const chipClassNames = {
  active: 'border-success-line bg-success-soft text-success-strong',
  soon: 'border-warning-line bg-warning-soft text-warning-strong'
} as const

/**
 * Speaks twice only: when five minutes are left and when time runs out.
 * The per-minute redraw stays silent.
 */
const useReauthAnnouncement = (clock: ReauthClock): string => {
  const { t } = useAdminPresentation()
  const previous = useRef(clock.state)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const from = previous.current
    previous.current = clock.state
    if (from === 'active' && clock.state === 'soon')
      setMessage(t('reauth.expiringSoon', { minutes: clock.minutes }))
    else if (from !== 'need' && clock.state === 'need')
      setMessage(t('reauth.expired'))
  }, [clock, t])
  return message
}

/**
 * Top bar status for admins: a re-verification button, or the time left as a
 * plain chip. The wrapper carries REAUTH_STATUS_ID so a closed return notice
 * hands focus back here.
 */
export const AdminReauthStatus = (): ReactElement => {
  const { t } = useAdminPresentation()
  const clock = useReauthClock()
  const reauth = useAdminReauth()
  const announcement = useReauthAnnouncement(clock)
  return (
    <div
      id={REAUTH_STATUS_ID}
      tabIndex={-1}
      role="group"
      aria-label={t('reauth.action')}
      className="flex items-center gap-2 rounded-control focus:outline-none"
    >
      {clock.state === 'need' || reauth.busy ? (
        <ReauthButton
          label={t('reauth.action')}
          busy={reauth.busy}
          onClick={() => reauth.start()}
        />
      ) : (
        <>
          <p
            className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-semibold ${chipClassNames[clock.state]}`}
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-current"
            />
            <span className="hidden sm:inline">
              {t('reauth.remaining', { minutes: clock.minutes })}
            </span>
            <span className="sm:hidden">
              {t('reauth.remainingShort', { minutes: clock.minutes })}
            </span>
          </p>
          {clock.state === 'soon' ? (
            <Button variant="outline" onClick={() => reauth.start()}>
              {t('reauth.extend')}
            </Button>
          ) : null}
        </>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

/** Top bar slot: the status only for admins, nothing on the not-found page. */
export const ReauthStatus = (): ReactElement | null => {
  const { role } = useAuth()
  return role === 'ADMIN' ? <AdminReauthStatus /> : null
}
