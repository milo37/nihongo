import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { useSsoAccountManagement } from '@app/login/hooks/useSsoAccountManagement'
import { SsoAccountDialog } from '@app/login/components/SsoAccountDialog'
import {
  SsoAccountActions,
  SsoProviderList
} from '@app/login/components/SsoAccountSections'
import { getSsoResultKey } from '@app/login/components/ssoAccountPresentation'
import { Button } from '@nihongo/browser/common/components/Button'

export const SsoAccountManagement = (): ReactElement | null => {
  const { t } = useTranslation('auth')
  const flow = useSsoAccountManagement()
  const headingId = useId()
  const trigger = useRef<HTMLElement | null>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const apple = useRef<HTMLButtonElement>(null)
  const google = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const caps = flow.capabilities.isError ? undefined : flow.capabilities.data
  const visibleProviders =
    caps?.providers.filter((p) => p.provider === 'google') ?? []
  const isLastVisibleMethod =
    visibleProviders.filter((p) => p.reauthAvailable).length <= 1
  const selected = flow.start.variables?.provider
  useEffect(() => {
    if (flow.start.isError)
      (selected === 'apple' ? apple : google).current?.focus()
  }, [flow.start.isError, selected])
  const result = flow.returnEvent
  const resultKey = getSsoResultKey(result, caps)
  if (!flow.isReady || !flow.user)
    return flow.feedback === 'unlinked' ? (
      <p role="status" className="auth-notice">
        {t('sso.unlinked')}
      </p>
    ) : null

  return (
    <section className="grid min-w-0 gap-4" aria-labelledby={headingId}>
      <h2 ref={heading} id={headingId} tabIndex={-1}>
        {t('sso.accountTitle')}
      </h2>
      {flow.capabilities.isPending ? (
        <p role="status">{t('sso.checkingAccount')}</p>
      ) : !caps ? (
        <div>
          <p role="alert">{t('sso.actionFailed')}</p>
          <Button
            className="whitespace-normal break-words"
            variant="outline"
            onClick={() => void flow.capabilities.refetch()}
          >
            {t('sso.recheck')}
          </Button>
        </div>
      ) : (
        <>
          {caps.providers.length === 0 ? (
            <p role="status">{t('sso.migrationIncomplete')}</p>
          ) : null}
          <SsoProviderList
            flow={flow}
            headingId={headingId}
            isLastVisibleMethod={isLastVisibleMethod}
            trigger={trigger}
            visibleProviders={visibleProviders}
          />
          <SsoAccountActions
            caps={caps}
            flow={flow}
            headingId={headingId}
            trigger={trigger}
          />
        </>
      )}
      {flow.busy && flow.dialog === null ? (
        <p role="status">{t('sso.processing')}</p>
      ) : null}
      {flow.feedback ? (
        <p role={flow.feedback === 'actionFailed' ? 'alert' : 'status'}>
          {t('sso.' + flow.feedback)}
        </p>
      ) : resultKey ? (
        <p role={result?.outcome === 'FAILED' ? 'alert' : 'status'}>
          {t('sso.' + resultKey)}
        </p>
      ) : null}
      {flow.uncertain ? (
        <Button
          className="whitespace-normal break-words"
          variant="outline"
          disabled={flow.busy}
          onClick={() => void flow.recheck()}
        >
          {t('sso.recheck')}
        </Button>
      ) : null}
      <Link to="/account/data">{t('sso.dataGuide')}</Link>
      <SsoAccountDialog
        caps={caps}
        cancel={cancel}
        flow={flow}
        google={google}
        heading={heading}
        trigger={trigger}
      />
    </section>
  )
}
