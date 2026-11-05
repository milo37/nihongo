import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { TextLink } from '@nihongo/browser/common/components/TextLink'

type ResultSetupLinkErrorProps = {
  autoFocus: boolean
  description: string
  title: string
}

export const ResultSetupLinkError = ({
  autoFocus,
  description,
  title
}: ResultSetupLinkErrorProps): ReactElement => {
  const { t } = useTranslation('result')
  return (
    <ErrorState
      autoFocus={autoFocus}
      headingLevel={1}
      title={title}
      description={description}
      action={<TextLink to="/practice">{t('newPractice')}</TextLink>}
    />
  )
}

type RetryNavigationDialogProps = {
  onStay: () => void
  open: boolean
}

export const RetryNavigationDialog = ({
  onStay,
  open
}: RetryNavigationDialogProps): ReactElement => {
  const { t } = useTranslation('result')
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onStay()
        }
      }}
      title={t('blocker.title')}
      description={t('blocker.description')}
      preventClose
      footer={
        <Button variant="secondary" onClick={onStay}>
          {t('blocker.stay')}
        </Button>
      }
    />
  )
}
