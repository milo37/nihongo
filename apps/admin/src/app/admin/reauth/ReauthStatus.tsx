import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ReauthButton } from '@nihongo/browser/app/reauth/components/ReauthButton'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { appI18n } from '@nihongo/browser/i18n/config'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { REAUTH_STATUS_ID } from '@nihongo/browser/app/reauth/components/ReauthReturnNotice'
import { useAdminReauth } from '@app/admin/reauth/useAdminReauth'
import type { AdminReauth } from '@app/admin/reauth/useAdminReauth'
import { useReauthClock } from '@app/admin/reauth/hooks/useReauthClock'
import type { ReauthClock } from '@app/admin/reauth/hooks/useReauthClock'
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
 * The top bar's request to leave for Google failed. Shown where the return
 * notice appears, in red with a retry; under 480px the buttons go below the
 * text so it keeps the width.
 */
const ReauthStartFailedNotice = ({
  reauth
}: {
  readonly reauth: AdminReauth
}): ReactElement => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  const commonT = appI18n.getFixedT(locale, 'common')
  const notice = useRef<HTMLElement>(null)
  useEffect(() => notice.current?.focus(), [])
  return (
    <aside
      ref={notice}
      tabIndex={-1}
      role="alert"
      data-reauth-result="startFailed"
      className="app-global-banner fixed whitespace-normal inset-x-4 bottom-4 z-50 mx-auto flex max-w-[560px] flex-col gap-2 rounded-xl border border-l-4 border-line border-l-danger bg-surface px-4 py-3 text-sm text-ink shadow-soft focus:outline-none min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between min-[480px]:gap-3"
    >
      <p className="min-w-0 flex-1 py-2.5 font-semibold leading-6 text-danger-strong">
        {t('reauth.startFailed')}
      </p>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <ReauthButton
          size="sm"
          label={t('reauth.retry')}
          busy={reauth.busy}
          onClick={() => reauth.start()}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label={commonT('actions.close')}
          onClick={() => {
            reauth.reset()
            document.getElementById(REAUTH_STATUS_ID)?.focus()
          }}
        >
          <span aria-hidden="true">✕</span>
        </Button>
      </div>
    </aside>
  )
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
      {reauth.startFailed ? <ReauthStartFailedNotice reauth={reauth} /> : null}
    </div>
  )
}

/** Top bar slot: the status only for admins, nothing on the not-found page. */
export const ReauthStatus = (): ReactElement | null => {
  const { role } = useAuth()
  return role === 'ADMIN' ? <AdminReauthStatus /> : null
}
