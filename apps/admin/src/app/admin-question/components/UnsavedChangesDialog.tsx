import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import type { QuestionDetailState } from '@app/admin-question/hooks/useQuestionDetail'

/** Leave-page guard while an edit or note is unsaved. */
export const UnsavedChangesDialog = ({
  state
}: {
  state: QuestionDetailState
}): ReactElement => {
  const { t, mutation, blocker } = state
  return (
    <>
      <Dialog
        open={blocker.state === 'blocked'}
        title={t('editor.unsavedTitle')}
        description={t('editor.unsavedDescription')}
        preventClose={mutation.isPending}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.()
        }}
        footer={
          <>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              {t('editor.keepEditing')}
            </Button>
            <Button
              variant="danger"
              disabled={mutation.isPending}
              onClick={() => blocker.proceed?.()}
            >
              {t('editor.discardAndLeave')}
            </Button>
          </>
        }
      />
    </>
  )
}
