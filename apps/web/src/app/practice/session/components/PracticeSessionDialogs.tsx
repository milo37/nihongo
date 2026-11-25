import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { useToast } from '@nihongo/browser/common/components/Toast'
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
  // #1262: a failed submit closes the dialog and says so in a toast. A
  // frozen attempt keeps its answers; [제출하기] opens this dialog again to
  // resend them. Being offline is the shared connection toast.
  const { addToast } = useToast()
  useEffect(() => {
    if (!isSubmissionError) return
    onOpenChange(false)
    addToast({
      key: 'submit',
      title: t(
        hasFrozenAttempt
          ? 'session.submit.frozenFailure'
          : 'session.submit.requestFailure'
      ),
      variant: 'warning'
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmissionError])

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
    />
  )
}
