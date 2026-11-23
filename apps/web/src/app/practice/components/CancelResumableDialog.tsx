import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'

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
        <p className="practice-cancel-error" role="alert">
          {t('setup.cancelDialog.error')}
        </p>
      ) : null}
    </Dialog>
  )
}
