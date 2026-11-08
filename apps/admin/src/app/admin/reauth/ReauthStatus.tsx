import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ReauthButton } from '@app/admin/reauth/ReauthButton'
import type { ReauthStart } from '@app/admin/reauth/ReauthButton'
import { useReauthClock } from '@app/admin/reauth/useReauthClock'
import type { ReauthClock } from '@app/admin/reauth/useReauthClock'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type ReauthStatusProps = { readonly start: ReauthStart }

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

/** Top bar status: a sign-in check button, or the time left as a plain chip. */
export const ReauthStatus = ({ start }: ReauthStatusProps): ReactElement => {
  const { t } = useAdminPresentation()
  const clock = useReauthClock()
  const announcement = useReauthAnnouncement(clock)
  return (
    <div className="flex items-center gap-2">
      {clock.state === 'need' || start.pending ? (
        <ReauthButton start={start} />
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
            <Button variant="outline" onClick={start.run}>
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
