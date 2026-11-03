import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Link } from 'react-router'
import type { useSsoAccountManagement } from '@app/login/hooks/useSsoAccountManagement'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import {
  providerName,
  type SsoCapabilities
} from '@app/login/components/ssoAccountPresentation'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'

type SsoAccountDialogProps = {
  caps: SsoCapabilities | undefined
  cancel: RefObject<HTMLButtonElement | null>
  flow: ReturnType<typeof useSsoAccountManagement>
  google: RefObject<HTMLButtonElement | null>
  heading: RefObject<HTMLHeadingElement | null>
  trigger: RefObject<HTMLElement | null>
}

// Confirms fresh sign-in, provider unlink, or account deletion for the account section.
export const SsoAccountDialog = ({
  caps,
  cancel,
  flow,
  google,
  heading,
  trigger
}: SsoAccountDialogProps): ReactElement => {
  const { t } = useTranslation('auth')
  const unlinkProvider =
    flow.dialog?.kind === 'unlink' ? flow.dialog.provider : null
  return (
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
                isLoading={
                  flow.busy &&
                  !flow.unlink.isPending &&
                  !flow.deletion.isPending &&
                  flow.start.variables?.purpose === 'ACCOUNT_FRESH' &&
                  flow.start.variables.provider === p.provider
                }
                loadingLabel={t('sso.redirecting', {
                  provider: providerName(p.provider)
                })}
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
      {flow.feedback ? <p role="status">{t('sso.' + flow.feedback)}</p> : null}
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
      {flow.busy && flow.dialog?.kind !== 'fresh' ? (
        <p role="status">{t('sso.processing')}</p>
      ) : null}
    </Dialog>
  )
}
