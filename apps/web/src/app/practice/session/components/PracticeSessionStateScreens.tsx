import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import type { SubmissionConnectivityCode } from '@app/practice/hooks/useSubmissionConnectivity'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'
import { TextLink } from '@nihongo/browser/common/components/TextLink'

const FramedSection = ({ children }: { children: ReactNode }): ReactElement => (
  <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
    {children}
  </section>
)

type SessionSetupLinkErrorProps = {
  title: string
  description: string
  framed?: boolean
}

export const SessionSetupLinkError = ({
  description,
  framed = false,
  title
}: SessionSetupLinkErrorProps): ReactElement => {
  const { t } = useTranslation('practice')
  const errorState = (
    <ErrorState
      autoFocus
      headingLevel={1}
      title={title}
      description={description}
      action={
        <TextLink to="/practice">{t('session.terminal.openSetup')}</TextLink>
      }
    />
  )
  return framed ? <FramedSection>{errorState}</FramedSection> : errorState
}

type SessionRecoveryStateProps = {
  connectivityMessage: SubmissionConnectivityCode | null
  description: string
  idleStatus: string
  onRetry: () => void
}

export const SessionRecoveryState = ({
  connectivityMessage,
  description,
  idleStatus,
  onRetry
}: SessionRecoveryStateProps): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <FramedSection>
      <ErrorState
        autoFocus
        headingLevel={1}
        title={t('session.recovery.title')}
        description={description}
        action={
          <div className="space-y-3">
            <Button onClick={onRetry}>{t('session.recovery.retry')}</Button>
            <p
              className="rounded-lg border border-warning-line bg-warning-soft p-3 text-sm leading-6 text-warning-strong"
              role="status"
              aria-live="polite"
            >
              {connectivityMessage
                ? t(`session.submit.connectivity.${connectivityMessage}`)
                : idleStatus}
            </p>
          </div>
        }
      />
    </FramedSection>
  )
}

type SessionLoadErrorProps = {
  description: string
  onRetry?: () => void
  retryLabel?: string
  title?: string
}

export const SessionLoadError = ({
  description,
  onRetry,
  retryLabel,
  title
}: SessionLoadErrorProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  return (
    <ErrorState
      autoFocus
      headingLevel={1}
      title={title ?? t('session.errors.sessionLoadTitle')}
      description={description}
      action={
        <div className="flex flex-wrap gap-2">
          {onRetry ? (
            <Button onClick={onRetry}>
              {retryLabel ?? commonT('actions.retry')}
            </Button>
          ) : null}
          <AppErrorReportButton />
        </div>
      }
    />
  )
}
