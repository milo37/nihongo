import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import { adminFreshSsoOutcomeSchema } from '@nihongo/contracts/auth/admin-fresh-sso'
import type { AdminFreshSsoOutcome } from '@nihongo/contracts/auth/admin-fresh-sso'
import { Button } from '../../../common/components/Button'
import { classNames } from '../../../common/components/classNames'
import { ReauthButton } from './ReauthButton'
import { useReauthReturn } from '../hooks/useReauthReturn'
import { REAUTH_RETURN_PARAM, useStartReauth } from '../hooks/useStartReauth'

/** Give the top bar re-verification chip or button this id; closing the notice returns focus to it. */
export const REAUTH_STATUS_ID = 'reauth-status'
const SUCCESS_CLOSE_MS = 8_000

type ReturnEvent = {
  key: string
  outcome: AdminFreshSsoOutcome
  attempt: number
}
type Tone = 'checking' | 'success' | 'error'

const readOutcome = (search: string): AdminFreshSsoOutcome | null => {
  const values = new URLSearchParams(search).getAll(REAUTH_RETURN_PARAM)
  if (values.length === 0) return null
  const parsed = adminFreshSsoOutcomeSchema.safeParse(
    values.length === 1 ? values[0] : null
  )
  return parsed.success ? parsed.data : 'INVALID_CALLBACK'
}

const failureKey = {
  REAUTHENTICATED: 'failed',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  INVALID_CALLBACK: 'invalid'
} as const satisfies Record<AdminFreshSsoOutcome, string>

const toneClassNames: Record<Tone, string> = {
  checking: 'border-l-warning',
  success: 'border-l-success',
  error: 'border-l-danger'
}

const ReturnCheck = ({
  outcome,
  onClose,
  onRecheck
}: {
  outcome: AdminFreshSsoOutcome
  onClose: () => void
  onRecheck: () => void
}): ReactElement => {
  const { t } = useTranslation('admin')
  const { t: commonT } = useTranslation('common')
  const check = useReauthReturn()
  const reauth = useStartReauth()
  const notice = useRef<HTMLElement>(null)
  const [paused, setPaused] = useState(false)
  const succeeded =
    check.phase === 'checked' && outcome === 'REAUTHENTICATED' && check.fresh
  const tone: Tone =
    check.phase === 'checking' ? 'checking' : succeeded ? 'success' : 'error'
  const key =
    check.phase === 'checking'
      ? 'checking'
      : check.phase === 'unknown'
        ? 'unknown'
        : succeeded
          ? 'returned'
          : failureKey[outcome]
  useEffect(() => {
    if (check.phase !== 'checking') notice.current?.focus()
  }, [check.phase])
  useEffect(() => {
    if (!succeeded || paused) return
    const timer = window.setTimeout(onClose, SUCCESS_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [onClose, paused, succeeded])
  return (
    <aside
      ref={notice}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      data-reauth-result={key}
      className={classNames(
        'app-global-banner reauth-return-notice fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-[560px] items-start justify-between gap-3 rounded-xl border border-l-4 border-line bg-surface px-4 py-3 text-sm text-ink shadow-soft',
        toneClassNames[tone]
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={(event) => {
        // The notice itself takes focus on arrival; only a control pauses it.
        if (event.target !== notice.current) setPaused(true)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
      }}
    >
      <p className="min-w-0 flex-1 py-2.5 leading-6">{t('reauth.' + key)}</p>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {check.phase === 'unknown' ? (
          <Button variant="outline" size="sm" onClick={onRecheck}>
            {t('reauth.recheck')}
          </Button>
        ) : tone === 'error' ? (
          <ReauthButton
            size="sm"
            label={t('reauth.retry')}
            busy={reauth.busy}
            onClick={() => reauth.start()}
          />
        ) : null}
        {check.phase === 'checking' ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={commonT('actions.close')}
            onClick={onClose}
          >
            <span aria-hidden="true">✕</span>
          </Button>
        )}
      </div>
    </aside>
  )
}

/**
 * Shows the result of an admin re-verification return (`?ssoFresh=`), checked
 * against the server, then removes the parameter so a reload does not show it
 * again.
 */
export const ReauthReturnNotice = ({
  suppressed = false
}: {
  suppressed?: boolean
}): ReactElement | null => {
  const location = useLocation()
  const navigate = useNavigate()
  const outcome = readOutcome(location.search)
  const [lastKey, setLastKey] = useState(location.key)
  const [event, setEvent] = useState<ReturnEvent | null>(() =>
    outcome ? { key: location.key, outcome, attempt: 0 } : null
  )
  if (outcome && lastKey !== location.key) {
    setLastKey(location.key)
    setEvent({ key: location.key, outcome, attempt: 0 })
  }
  useEffect(() => {
    const search = new URLSearchParams(location.search)
    if (!search.has(REAUTH_RETURN_PARAM)) return
    search.delete(REAUTH_RETURN_PARAM)
    // Router paths are already inside the app's basename.
    void navigate(
      { pathname: location.pathname, search: search.toString(), hash: '' },
      { replace: true, state: null }
    )
  }, [location.pathname, location.search, navigate])
  if (!event || suppressed) return null
  return (
    <ReturnCheck
      key={`${event.key}:${event.attempt}`}
      outcome={event.outcome}
      onRecheck={() => setEvent({ ...event, attempt: event.attempt + 1 })}
      onClose={() => {
        setEvent(null)
        document.getElementById(REAUTH_STATUS_ID)?.focus()
      }}
    />
  )
}
