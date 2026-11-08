import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import type { ReactElement } from 'react'
import type { useQuestionArchive } from '@app/admin-question/hooks/useQuestionArchive'
import { getAdminErrorKey } from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { isDraftOnly } from '@app/admin-question/components/QuestionListTable'
import {
  ReauthDialogButton,
  ReauthRequiredNotice
} from '@app/admin/reauth/ReauthRequiredNotice'
import { useAdminReauth } from '@app/admin/reauth/useAdminReauth'

type ArchiveQuestionDialogProps = {
  archive: ReturnType<typeof useQuestionArchive>
}

export const ArchiveQuestionDialog = ({
  archive
}: ArchiveQuestionDialogProps): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const reauth = useAdminReauth()
  const { question, needsFresh, conflict } = archive
  const draft = question !== null && isDraftOnly(question)
  const copy = draft ? 'questionList.draftDialog' : 'questionList.archiveDialog'
  return (
    <Dialog
      open={question !== null}
      title={t(`${copy}.title`)}
      description={
        question
          ? t(`${copy}.description`, {
              questionId: question.questionId
            })
          : undefined
      }
      footer={
        <>
          <Button
            variant="secondary"
            disabled={archive.isPending}
            onClick={archive.close}
          >
            {t('questionList.archiveDialog.cancel')}
          </Button>
          {needsFresh ? (
            <ReauthDialogButton reauth={reauth} />
          ) : (
            <Button
              variant="danger"
              isLoading={archive.isPending}
              disabled={conflict}
              loadingLabel={t(`${copy}.confirming`)}
              onClick={() => void archive.archive()}
            >
              {t(`${copy}.confirm`)}
            </Button>
          )}
        </>
      }
      onOpenChange={(open) => {
        if (!open && !archive.isPending) {
          archive.close()
        }
      }}
    >
      {draft ? null : (
        <>
          <p className="leading-7 text-muted">
            {t('questionList.archiveDialog.body')}
          </p>
          <p className="mt-2 leading-7 text-muted">
            {t('questionList.archiveDialog.duplicateNote')}
          </p>
        </>
      )}
      {needsFresh ? (
        <ReauthRequiredNotice
          command={t(`${copy}.confirm`)}
          keeps="selection"
          reauth={reauth}
        />
      ) : null}
      {conflict ? (
        <Button variant="secondary" onClick={archive.refresh}>
          {t('questionList.archiveDialog.refresh')}
        </Button>
      ) : null}
      {archive.refreshFailed ? (
        <p role="alert">{t('questionList.archiveDialog.refreshFailed')}</p>
      ) : null}
      {archive.isError && !needsFresh ? (
        <p className="mt-4 text-sm font-semibold text-red-700" role="alert">
          {conflict
            ? t('questionList.archiveDialog.conflict')
            : getAdminErrorKey(archive.error) === 'errors.generic'
              ? t(`${copy}.failed`)
              : presentError(archive.error)}
        </p>
      ) : null}
    </Dialog>
  )
}
