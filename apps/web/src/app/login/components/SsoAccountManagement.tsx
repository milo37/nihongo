import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { useSsoAccountManagement } from '@app/login/hooks/useSsoAccountManagement'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
const providerName = (provider: SsoProviderId) =>
  provider === 'apple' ? 'Apple' : 'Google'

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
  const resultKey = !result
    ? null
    : result.outcome === 'CANCELLED'
      ? 'cancelledAccount'
      : result.outcome === 'INVALID_CALLBACK'
        ? 'expired'
        : result.outcome === 'FAILED'
          ? 'actionFailed'
          : result.kind === 'fresh'
            ? caps?.freshVerified
              ? 'freshConfirmed'
              : 'checkingAccount'
            : caps?.providers.length === 2
              ? 'linked'
              : 'checkingAccount'
  const unlinkProvider =
    flow.dialog?.kind === 'unlink' ? flow.dialog.provider : null
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
          <ul className="grid min-w-0 gap-4">
            {visibleProviders.map((p, index) => (
              <li
                key={p.provider}
                className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:justify-between"
              >
                <div className="w-full min-w-0 break-words sm:w-auto sm:flex-1">
                  <strong>{providerName(p.provider)}</strong>
                  <p>{t('sso.connected')}</p>
                  {!p.reauthAvailable ? (
                    <p>
                      {t('sso.unavailableProvider', {
                        provider: providerName(p.provider)
                      })}
                    </p>
                  ) : null}
                  {!p.canUnlink || isLastVisibleMethod ? (
                    <p id={headingId + '-reason-' + index}>
                      {t(
                        p.unlinkBlockedReason === 'PROVIDER_UNAVAILABLE'
                          ? 'sso.remainingUnavailable'
                          : 'sso.lastMethodTitle'
                      )}
                    </p>
                  ) : null}
                </div>
                <Button
                  className="whitespace-normal break-words"
                  variant="outline"
                  disabled={
                    !p.canUnlink ||
                    isLastVisibleMethod ||
                    flow.busy ||
                    flow.uncertain
                  }
                  aria-describedby={
                    !p.canUnlink || isLastVisibleMethod
                      ? headingId + '-reason-' + index
                      : undefined
                  }
                  aria-label={
                    providerName(p.provider) + ' ' + t('sso.unlinkAction')
                  }
                  onClick={(event) => {
                    trigger.current = event.currentTarget
                    flow.request({ kind: 'unlink', provider: p.provider })
                  }}
                >
                  {t('sso.unlinkAction')}
                </Button>
              </li>
            ))}
          </ul>
          {caps.providers.length === 0 ||
          caps.providers.some((p) => !p.reauthAvailable) ? (
            <Button
              className="whitespace-normal break-words"
              variant="outline"
              disabled={flow.busy || flow.capabilities.isFetching}
              onClick={() => void flow.capabilities.refetch()}
            >
              {t('sso.recheck')}
            </Button>
          ) : null}
          <div className="auth-actions">
            {caps.linkableProviders
              .filter((provider) => provider === 'google')
              .map((provider) => (
                <Button
                  className="whitespace-normal break-words"
                  key={provider}
                  variant="outline"
                  disabled={flow.busy || flow.uncertain}
                  onClick={(event) => {
                    trigger.current = event.currentTarget
                    flow.begin('ACCOUNT_LINK', provider)
                  }}
                >
                  {t('sso.linkProvider', { provider: providerName(provider) })}
                </Button>
              ))}
            <Button
              className="whitespace-normal break-words"
              variant="outline"
              disabled={
                flow.busy ||
                flow.uncertain ||
                !caps.providers.some(
                  (p) => p.provider === 'google' && p.reauthAvailable
                )
              }
              onClick={(event) => {
                trigger.current = event.currentTarget
                flow.request({ kind: 'fresh' })
              }}
            >
              {t('sso.reauthTitle')}
            </Button>
            <Button
              className="whitespace-normal break-words"
              variant="danger"
              disabled={flow.busy || flow.uncertain || !caps.canDelete}
              aria-describedby={
                !caps.canDelete ? headingId + '-delete-reason' : undefined
              }
              onClick={(event) => {
                trigger.current = event.currentTarget
                flow.request({ kind: 'delete' })
              }}
            >
              {t('sso.deleteAction')}
            </Button>
          </div>
          {!caps.canDelete ? (
            <p id={headingId + '-delete-reason'}>{t('sso.openAdminWork')}</p>
          ) : null}
          <p>
            {t(caps.freshVerified ? 'sso.freshConfirmed' : 'sso.freshNeeded')}
          </p>
        </>
      )}
      {flow.busy ? <p role="status">{t('sso.processing')}</p> : null}
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
      <Dialog
        className="[&_.ui-dialog-footer]:flex-col sm:[&_.ui-dialog-footer]:flex-row"
        open={flow.dialog !== null}
        onOpenChange={(open) => {
          if (!open && !flow.busy) flow.setDialog(null)
        }}
        title={t(
          flow.dialog?.kind === 'fresh'
            ? 'sso.reauthTitle'
            : flow.dialog?.kind === 'unlink'
              ? 'sso.unlinkTitle'
              : 'sso.deleteTitle',
          { provider: unlinkProvider ? providerName(unlinkProvider) : '' }
        )}
        description={
          flow.dialog?.kind === 'fresh'
            ? t('sso.freshNeeded')
            : flow.dialog?.kind === 'unlink'
              ? t('sso.unlinkDescription', {
                  provider: unlinkProvider ? providerName(unlinkProvider) : ''
                })
              : t('sso.deleteDescription')
        }
        preventClose={flow.busy}
        initialFocusRef={cancel}
        returnFocusRef={trigger}
        fallbackFocusRef={heading}
        footer={
          <>
            <Button
              className="whitespace-normal break-words"
              ref={cancel}
              variant="outline"
              disabled={flow.busy}
              onClick={() => flow.setDialog(null)}
            >
              {t('sso.cancel')}
            </Button>
            {flow.dialog?.kind !== 'fresh' && !flow.uncertain ? (
              <Button
                className="whitespace-normal break-words"
                variant="danger"
                disabled={flow.busy}
                onClick={() => {
                  if (flow.busy) return
                  if (flow.dialog?.kind === 'unlink')
                    flow.unlink.mutate({ provider: flow.dialog.provider })
                  else if (flow.dialog?.kind === 'delete')
                    flow.deletion.mutate({})
                }}
              >
                {t(
                  flow.dialog?.kind === 'unlink'
                    ? 'sso.unlinkAction'
                    : 'sso.deleteAction'
                )}
              </Button>
            ) : null}
          </>
        }
      >
        {flow.dialog?.kind === 'fresh' ? (
          <div className="auth-actions">
            {caps?.providers
              .filter((p) => p.provider === 'google' && p.reauthAvailable)
              .map((p) => (
                <SsoProviderButton
                  key={p.provider}
                  provider={p.provider}
                  buttonRef={google}
                  label={t('sso.continueGoogle')}
                  disabled={flow.busy}
                  onClick={() => flow.begin('ACCOUNT_FRESH', p.provider)}
                />
              ))}
            {!caps?.providers.some(
              (p) => p.provider === 'google' && p.reauthAvailable
            ) ? (
              <p role="status">{t('sso.remainingUnavailable')}</p>
            ) : null}
          </div>
        ) : (
          <Link to="/account/data">{t('sso.dataGuide')}</Link>
        )}
        {flow.feedback ? (
          <p role="status">{t('sso.' + flow.feedback)}</p>
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
        {flow.busy ? <p role="status">{t('sso.processing')}</p> : null}
      </Dialog>
    </section>
  )
}
