import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { useLatest } from '@nihongo/browser/common/hooks/useLatest'
import { useToast } from '@nihongo/browser/common/components/Toast'

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
  // #1262: a failed discard closes the dialog (a toast would sit under it)
  // and says so in a toast; the list's [버리기] is still there.
  const { addToast } = useToast()
  const keepRef = useLatest(onKeep)
  useEffect(() => {
    if (!hasError) return
    keepRef.current()
    addToast({
      key: 'set-cancel',
      title: t('setup.cancelDialog.error'),
      variant: 'warning'
    })
  }, [keepRef, hasError, addToast, t])
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
    ></Dialog>
  )
}
