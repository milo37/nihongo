import { useTranslation } from 'react-i18next'
import type { MouseEvent, ReactElement, RefObject } from 'react'
import type { useSsoAccountManagement } from '@app/login/hooks/useSsoAccountManagement'
import {
  providerName,
  type SsoCapabilities
} from '@app/login/components/ssoAccountPresentation'
import { Button } from '@nihongo/browser/common/components/Button'

type SsoAccountFlow = ReturnType<typeof useSsoAccountManagement>

type SsoProviderListProps = {
  flow: SsoAccountFlow
  headingId: string
  isLastVisibleMethod: boolean
  trigger: RefObject<HTMLElement | null>
  visibleProviders: SsoCapabilities['providers']
}

export const SsoProviderList = ({
  flow,
  headingId,
  isLastVisibleMethod,
  trigger,
  visibleProviders
}: SsoProviderListProps): ReactElement => {
  const { t } = useTranslation('auth')
  return (
    <ul className="grid min-w-0 gap-4">
      {visibleProviders.map((p, index) => {
        const isUnlinkBlocked = !p.canUnlink || isLastVisibleMethod
        const reasonId = headingId + '-reason-' + index
        return (
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
              {isUnlinkBlocked ? (
                <p id={reasonId}>
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
              disabled={isUnlinkBlocked || flow.busy || flow.uncertain}
              aria-describedby={isUnlinkBlocked ? reasonId : undefined}
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
        )
      })}
    </ul>
  )
}

type SsoAccountActionsProps = {
  caps: SsoCapabilities
  flow: SsoAccountFlow
  headingId: string
  trigger: RefObject<HTMLElement | null>
}

export const SsoAccountActions = ({
  caps,
  flow,
  headingId,
  trigger
}: SsoAccountActionsProps): ReactElement => {
  const { t } = useTranslation('auth')
  const deleteReasonId = headingId + '-delete-reason'
  const withTrigger =
    (action: () => void) =>
    (event: MouseEvent<HTMLButtonElement>): void => {
      trigger.current = event.currentTarget
      action()
    }
  return (
    <>
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
              onClick={withTrigger(() => flow.begin('ACCOUNT_LINK', provider))}
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
          onClick={withTrigger(() => flow.request({ kind: 'fresh' }))}
        >
          {t('sso.reauthTitle')}
        </Button>
        <Button
          className="whitespace-normal break-words"
          variant="danger"
          disabled={flow.busy || flow.uncertain || !caps.canDelete}
          aria-describedby={!caps.canDelete ? deleteReasonId : undefined}
          onClick={withTrigger(() => flow.request({ kind: 'delete' }))}
        >
          {t('sso.deleteAction')}
        </Button>
      </div>
      {!caps.canDelete ? (
        <p id={deleteReasonId}>{t('sso.openAdminWork')}</p>
      ) : null}
      <p>{t(caps.freshVerified ? 'sso.freshConfirmed' : 'sso.freshNeeded')}</p>
    </>
  )
}
