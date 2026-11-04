import { AppLink } from '@nihongo/browser/common/components/AppLink'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { useLocation } from 'react-router'
import type { ReactElement } from 'react'
import type { useQuestionArchive } from '@app/admin-question/hooks/useQuestionArchive'
import { getAdminErrorKey } from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type ArchiveQuestionDialogProps = {
  archive: ReturnType<typeof useQuestionArchive>
}

export const ArchiveQuestionDialog = ({
  archive
}: ArchiveQuestionDialogProps): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const location = useLocation()
  const { question, needsFresh, conflict } = archive
  return (
    <Dialog
      open={question !== null}
      title={t('questionList.archiveDialog.title')}
      description={
        question
          ? t('questionList.archiveDialog.description', {
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
            loadingLabel={t('questionList.archiveDialog.confirming')}
            onClick={() => void archive.archive()}
          >
            {t('questionList.archiveDialog.confirm')}
          </Button>
        </>
      }
      onOpenChange={(open) => {
        if (!open && !archive.isPending) {
          archive.close()
        }
      }}
    >
      <p className="leading-7 text-muted">
        {t('questionList.archiveDialog.body')}
      </p>
      <p className="mt-2 leading-7 text-muted">
        {t('questionList.archiveDialog.duplicateNote')}
      </p>
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
                ? t('questionList.archiveDialog.failed')
                : presentError(archive.error)}
        </p>
      ) : null}
    </Dialog>
  )
}
