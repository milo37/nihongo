import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'

type BookmarkRemoveDialogProps = {
  fallbackFocusRef: RefObject<HTMLHeadingElement | null>
  isRemoving: boolean
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  returnFocusRef: RefObject<HTMLButtonElement | null>
}

export const BookmarkRemoveDialog = ({
  fallbackFocusRef,
  isRemoving,
  onCancel,
  onConfirm,
  open,
  returnFocusRef
}: BookmarkRemoveDialogProps): ReactElement => {
  const { t } = useTranslation('bookmark')
  return (
    <Dialog
      fallbackFocusRef={fallbackFocusRef}
      open={open}
      preventClose={isRemoving}
      returnFocusRef={returnFocusRef}
      title={t('removeDialog.title')}
      description={t('removeDialog.description')}
      footer={
        <>
          <Button disabled={isRemoving} variant="outline" onClick={onCancel}>
            {t('removeDialog.cancel')}
          </Button>
          <Button isLoading={isRemoving} variant="danger" onClick={onConfirm}>
            {t('removeDialog.confirm')}
          </Button>
        </>
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isRemoving) {
          onCancel()
        }
      }}
    />
  )
}
