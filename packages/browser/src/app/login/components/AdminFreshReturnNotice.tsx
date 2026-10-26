import { getAppPath, useAppNavigate } from '../../../libs/appNavigation'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHref, useLocation } from 'react-router'
import type { ReactElement } from 'react'
import {
  adminFreshSsoOutcomeSchema,
  safeAdminFreshReturnPath
} from '@nihongo/contracts/auth/admin-fresh-sso'
import type { AdminFreshSsoOutcome } from '@nihongo/contracts/auth/admin-fresh-sso'
import { useAdminFreshReturn } from '../hooks/useAdminFreshReturn'

type ReturnEvent = { key: string; outcome: AdminFreshSsoOutcome }
const readOutcome = (search: string): AdminFreshSsoOutcome | null => {
  const values = new URLSearchParams(search).getAll('ssoFresh')
  if (values.length === 0) return null
  const parsed = adminFreshSsoOutcomeSchema.safeParse(
    values.length === 1 ? values[0] : null
  )
  return parsed.success ? parsed.data : 'INVALID_CALLBACK'
}
const ReturnCheck = ({
  event,
  onClose,
  suppressed
}: {
  event: ReturnEvent
  onClose: () => void
  suppressed: boolean
}): ReactElement | null => {
  const { t } = useTranslation('auth')
  const { t: commonT } = useTranslation('common')
  const phase = useAdminFreshReturn()
  const notice = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!suppressed && phase !== 'checking') notice.current?.focus()
  }, [phase, suppressed])
  if (suppressed) return null
  const key =
    phase === 'checking'
      ? 'checking'
      : phase === 'unknown'
        ? 'unknown'
        : event.outcome === 'REAUTHENTICATED'
          ? 'returned'
          : event.outcome === 'CANCELLED'
            ? 'cancelled'
            : event.outcome === 'FAILED'
              ? 'failed'
              : 'invalid'
  return (
    <aside
      ref={notice}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className="app-global-banner fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink shadow-soft"
    >
      <span>{t('adminFresh.' + key)}</span>
      <button
        type="button"
        className="min-h-11 shrink-0 rounded-lg px-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        onClick={onClose}
      >
        {commonT('actions.close')}
      </button>
    </aside>
  )
}
export const AdminFreshReturnNotice = ({
  suppressed = false
}: {
  suppressed?: boolean
}): ReactElement | null => {
  const routeLocation = useLocation()
  const basename = useHref('/')
  const location = {
    ...routeLocation,
    pathname: getAppPath(routeLocation.pathname, basename)
  }
  const navigate = useAppNavigate()
  const outcome = readOutcome(location.search)
  const [lastKey, setLastKey] = useState(location.key)
  const [event, setEvent] = useState<ReturnEvent | null>(() =>
    outcome ? { key: location.key, outcome } : null
  )
  if (outcome && lastKey !== location.key) {
    setLastKey(location.key)
    setEvent({ key: location.key, outcome })
  }
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('ssoFresh')) return
    const search = new URLSearchParams(location.search)
    search.delete('ssoFresh')
    const safe = safeAdminFreshReturnPath(
      location.pathname + (search.size ? '?' + search.toString() : '')
    )
    void navigate(safe, { replace: true, state: null })
  }, [location.pathname, location.search, navigate])
  return event ? (
    <ReturnCheck
      key={event.key}
      event={event}
      suppressed={suppressed}
      onClose={() => setEvent(null)}
    />
  ) : null
}
