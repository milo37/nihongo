import { AppLink } from '@nihongo/browser/common/components/AppLink'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { useLocation } from 'react-router'
import type { ReactElement } from 'react'
import type { useQuestionArchive } from '@app/admin-question/hooks/useQuestionArchive'
import { getAdminErrorKey } from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { isDraftOnly } from '@app/admin-question/components/QuestionListTable'

type ArchiveQuestionDialogProps = {
  archive: ReturnType<typeof useQuestionArchive>
}

export const ArchiveQuestionDialog = ({
  archive
}: ArchiveQuestionDialogProps): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const location = useLocation()
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
          <Button
            variant="danger"
            isLoading={archive.isPending}
            disabled={needsFresh || conflict}
            loadingLabel={t(`${copy}.confirming`)}
            onClick={() => void archive.archive()}
          >
            {t(`${copy}.confirm`)}
          </Button>
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
        <AppLink
          to={`/login?redirect=${encodeURIComponent('/admin/questions' + location.search)}`}
          className="mt-4 inline-flex min-h-11 items-center font-semibold underline"
        >
          {t('questionList.archiveDialog.reauthenticate')}
        </AppLink>
      ) : null}
      {conflict ? (
        <Button variant="secondary" onClick={archive.refresh}>
          {t('questionList.archiveDialog.refresh')}
        </Button>
      ) : null}
      {archive.refreshFailed ? (
        <p role="alert">{t('questionList.archiveDialog.refreshFailed')}</p>
      ) : null}
      {archive.isError ? (
        <p className="mt-4 text-sm font-semibold text-red-700" role="alert">
          {needsFresh
            ? t('questionList.archiveDialog.freshRequired')
            : conflict
              ? t('questionList.archiveDialog.conflict')
              : getAdminErrorKey(archive.error) === 'errors.generic'
                ? t(`${copy}.failed`)
                : presentError(archive.error)}
        </p>
      ) : null}
    </Dialog>
  )
}
