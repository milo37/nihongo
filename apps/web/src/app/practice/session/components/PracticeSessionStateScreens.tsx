import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'
import { TextLink } from '@nihongo/browser/common/components/TextLink'

const FramedSection = ({ children }: { children: ReactNode }): ReactElement => (
  <section className="study-state-frame">{children}</section>
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
        <div className="study-state-actions">
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
