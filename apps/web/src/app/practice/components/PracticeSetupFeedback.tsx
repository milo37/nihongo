import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import type { StudyMode } from '@nihongo/browser/common/types/domain'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'

type PracticeSetupFeedbackProps = {
  accountRestricted: boolean
  hasCreateError: boolean
  mode: StudyMode
  noEligibleQuestions: boolean
  onSelectRandom: () => void
}

export const PracticeSetupFeedback = ({
  accountRestricted,
  hasCreateError,
  mode,
  noEligibleQuestions,
  onSelectRandom
}: PracticeSetupFeedbackProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  return (
    <>
      {accountRestricted ? (
        <AccountRestrictedNotice />
      ) : noEligibleQuestions ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
          role="alert"
        >
          <p className="font-bold">
            {t('setup.noEligibleTitle', {
              mode: t(`setup.modes.${mode}.label`)
            })}
          </p>
          <p className="mt-1 leading-6">{t('setup.noEligibleDescription')}</p>
          {mode !== 'RANDOM' ? (
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={onSelectRandom}
            >
              {t('setup.selectRandom')}
            </Button>
          ) : null}
        </div>
      ) : hasCreateError ? (
        <ErrorState
          title={commonT('state.requestFailed')}
          description={t('setup.createError')}
        />
      ) : null}
    </>
  )
}

type CancelResumableDialogProps = {
  fallbackFocusRef: RefObject<HTMLHeadingElement | null>
  hasError: boolean
  isCancelling: boolean
  onConfirm: () => void
  onKeep: () => void
  open: boolean
}

export const CancelResumableDialog = ({
  fallbackFocusRef,
  hasError,
  isCancelling,
  onConfirm,
  onKeep,
  open
}: CancelResumableDialogProps): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <Dialog
      open={open}
      fallbackFocusRef={fallbackFocusRef}
      title={t('setup.cancelDialog.title')}
      description={t('setup.cancelDialog.description')}
      footer={
        <>
          <Button variant="secondary" disabled={isCancelling} onClick={onKeep}>
            {t('setup.cancelDialog.keep')}
          </Button>
          <Button isLoading={isCancelling} onClick={onConfirm}>
            {t('setup.cancelDialog.confirm')}
          </Button>
        </>
      }
      preventClose={isCancelling}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isCancelling) {
          onKeep()
        }
      }}
    >
      {hasError ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
          role="alert"
        >
          {t('setup.cancelDialog.error')}
        </p>
      ) : null}
    </Dialog>
  )
}
