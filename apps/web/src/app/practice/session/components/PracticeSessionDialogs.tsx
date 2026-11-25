import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { useToast } from '@nihongo/browser/common/components/Toast'
import type { SubmissionConnectivityCode } from '@app/practice/hooks/useSubmissionConnectivity'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeNavigationGuardDialogProps = {
  onContinue: () => void
  onLeave: () => void
  open: boolean
}

/** Asked of a guest only: leaving drops this try (subtract #8, U4 G3). */
export const PracticeNavigationGuardDialog = ({
  onContinue,
  onLeave,
  open
}: PracticeNavigationGuardDialogProps): ReactElement => {
  const { t } = useTranslation('practice')
  const keepRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      title={t('session.exitGuest.title')}
      description={t('session.exitGuest.description')}
      initialFocusRef={keepRef}
      footer={
        <>
          <Button ref={keepRef} variant="ghost" onClick={onContinue}>
            {t('session.exitGuest.keep')}
          </Button>
          <Button onClick={onLeave}>{t('session.exitGuest.leave')}</Button>
        </>
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onContinue()
        }
      }}
    />
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
  // #1262: a definite failure closes the dialog and says so in a toast (the
  // submit button is still there). A frozen attempt keeps the dialog open:
  // the same answers must be sent again, so its message stays inside.
  const { addToast } = useToast()
  const showsToast = isSubmissionError && !hasFrozenAttempt
  useEffect(() => {
    if (!showsToast) return
    onOpenChange(false)
    addToast({
      key: 'submit',
      title: t('session.submit.requestFailure'),
      variant: 'warning'
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showsToast])

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
            variant="ghost"
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
      {(isSubmissionError && hasFrozenAttempt) || frozenConnectivityMessage ? (
        <div className="study-state-stack">
          {isSubmissionError && hasFrozenAttempt ? (
            <div className="study-submit-error" role="alert">
              {t('session.submit.frozenFailure')}
            </div>
          ) : null}
          {frozenConnectivityMessage ? (
            <p
              className="study-submit-offline"
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
