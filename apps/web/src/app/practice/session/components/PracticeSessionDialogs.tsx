import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import type { SubmissionConnectivityCode } from '@app/practice/hooks/useSubmissionConnectivity'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeNavigationGuardDialogProps = {
  isGuest: boolean
  isSaving: boolean
  onContinue: () => void
  onLeave: () => void
  onSaveAndLeave: () => void
  open: boolean
}

export const PracticeNavigationGuardDialog = ({
  isGuest,
  isSaving,
  onContinue,
  onLeave,
  onSaveAndLeave,
  open
}: PracticeNavigationGuardDialogProps): ReactElement => {
  const { t } = useTranslation('practice')
  const keepRef = useRef<HTMLButtonElement>(null)
  // A guest cannot resume, so leaving drops this try (U4 G3).
  const copy = isGuest ? 'session.exitGuest' : 'session.navigationGuard'
  return (
    <Dialog
      open={open}
      title={t(`${copy}.title`)}
      description={t(`${copy}.description`)}
      initialFocusRef={keepRef}
      footer={
        <>
          <Button
            ref={keepRef}
            variant="secondary"
            disabled={isSaving}
            onClick={onContinue}
          >
            {t(
              isGuest
                ? 'session.exitGuest.keep'
                : 'session.navigationGuard.continue'
            )}
          </Button>
          {isGuest ? (
            <Button onClick={onLeave}>{t('session.exitGuest.leave')}</Button>
          ) : (
            <Button isLoading={isSaving} onClick={onSaveAndLeave}>
              {t('session.navigationGuard.saveAndLeave')}
            </Button>
          )}
        </>
      }
      preventClose={isSaving}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSaving) {
          onContinue()
        }
      }}
    >
      {isGuest ? (
        <p className="text-sm leading-6 text-muted">
          {t('session.exitGuest.countNotBack')}
        </p>
      ) : null}
    </Dialog>
  )
}

type PracticeSubmitDialogProps = {
  connectivityMessage: SubmissionConnectivityCode | null
  hasFrozenAttempt: boolean
  isConfirmDisabled: boolean
  isConfirmLoading: boolean
  isContinueDisabled: boolean
  isSubmissionError: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  returnFocusRef: RefObject<HTMLButtonElement | null>
  unansweredCount: number
}

export const PracticeSubmitDialog = ({
  connectivityMessage,
  hasFrozenAttempt,
  isConfirmDisabled,
  isConfirmLoading,
  isContinueDisabled,
  isSubmissionError,
  onConfirm,
  onOpenChange,
  open,
  returnFocusRef,
  unansweredCount
}: PracticeSubmitDialogProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { formatCount } = usePracticeNumberFormat()
  const frozenConnectivityMessage = hasFrozenAttempt
    ? connectivityMessage
    : null

  return (
    <Dialog
      open={open}
      title={t('session.submit.title')}
      returnFocusRef={returnFocusRef}
      description={
        hasFrozenAttempt
          ? t('session.submit.frozenDescription')
          : unansweredCount > 0
            ? t('session.submit.unansweredDescription', {
                unanswered: formatCount(unansweredCount)
              })
            : t('session.submit.completeDescription')
      }
      footer={
        <>
          <Button
            variant="secondary"
            disabled={isContinueDisabled}
            onClick={() => onOpenChange(false)}
          >
            {t('session.submit.continue')}
          </Button>
          <Button
            disabled={isConfirmDisabled}
            isLoading={isConfirmLoading}
            onClick={onConfirm}
          >
            {t('session.submit.confirm')}
          </Button>
        </>
      }
      preventClose={isContinueDisabled}
      onOpenChange={onOpenChange}
    >
      {isSubmissionError || frozenConnectivityMessage ? (
        <div className="space-y-3">
          {isSubmissionError ? (
            <div
              className="rounded-lg border border-danger-line bg-danger-soft p-4 text-sm leading-6 text-danger-strong"
              role="alert"
            >
              {hasFrozenAttempt
                ? t('session.submit.frozenFailure')
                : t('session.submit.requestFailure')}
            </div>
          ) : null}
          {frozenConnectivityMessage ? (
            <p
              className="rounded-lg border border-warning-line bg-warning-soft p-4 text-sm leading-6 text-warning-strong"
              role="status"
              aria-live="polite"
            >
              {t(`session.submit.connectivity.${frozenConnectivityMessage}`)}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  )
}
