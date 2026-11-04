import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { buildQuestionCommand } from '@app/admin-question/detail/questionWorkflow'
import type { QuestionDetailState } from '@app/admin-question/hooks/useQuestionDetail'

/** Confirmation dialog for the pending workflow command. */
export const QuestionCommandDialog = ({
  state
}: {
  state: QuestionDetailState
}): ReactElement => {
  const {
    t,
    presentError,
    commandLabel,
    draftOnly,
    workflow,
    detail,
    selected,
    preview,
    heading,
    noteInput,
    dirty,
    pending,
    setPending,
    note,
    setNote,
    setAnnouncement,
    refreshing,
    mutation,
    code,
    conflict,
    candidate,
    commandStale,
    locked,
    commands,
    refreshSnapshot,
    fresh,
    reasonRequired,
    noteError,
    showNote
  } = state
  return (
    <>
      <Dialog
        open={pending !== null}
        title={
          pending === 'ARCHIVE' && draftOnly
            ? t('questionList.draftDialog.title')
            : pending
              ? t('questionDetail.commandDialogTitle', {
                  command: commandLabel(pending)
                })
              : t('questionDetail.commandDialogFallbackTitle')
        }
        description={t('questionDetail.commandDialogDescription')}
        fallbackFocusRef={heading}
        preventClose={mutation.isPending}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setPending(null)
        }}
        footer={
          <>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setPending(null)}
            >
              {t('questionDetail.cancel')}
            </Button>
            {conflict || commandStale ? (
              <Button
                disabled={refreshing || workflow.isOffline}
                onClick={() => void refreshSnapshot()}
              >
                {t('questionDetail.retryConflict')}
              </Button>
            ) : code === 'FRESH_ASSURANCE_REQUIRED' ? (
              <Button onClick={fresh}>{t('reportDetail.fresh')}</Button>
            ) : (
              <Button
                disabled={
                  locked ||
                  dirty ||
                  !pending ||
                  !commands.includes(pending) ||
                  Boolean(noteError) ||
                  Boolean(reasonRequired && !note.trim())
                }
                isLoading={mutation.isPending}
                onClick={() => {
                  if (
                    !pending ||
                    !detail.data ||
                    !selected ||
                    !preview.data ||
                    locked ||
                    dirty
                  )
                    return
                  try {
                    void mutation
                      .mutateAsync(
                        buildQuestionCommand(
                          pending,
                          detail.data,
                          selected,
                          preview.data,
                          note,
                          candidate
                        )
                      )
                      .catch(() => undefined)
                  } catch {
                    noteInput.current?.focus()
                    setAnnouncement(t('errors.validation'))
                  }
                }}
              >
                {t('questionDetail.execute')}
              </Button>
            )}
          </>
        }
      >
        {pending === 'ARCHIVE' && draftOnly && detail.data ? (
          <p className="mb-4">
            {t('questionList.draftDialog.description', {
              questionId: detail.data.question.questionId
            })}
          </p>
        ) : (
          <>
            {pending === 'ARCHIVE' ? (
              <>
                <p className="mb-2 leading-7 text-muted">
                  {t('questionList.archiveDialog.body')}
                </p>
                <p className="mb-4 leading-7 text-muted">
                  {t('questionList.archiveDialog.duplicateNote')}
                </p>
              </>
            ) : null}
            {/* The learner-exposure warning does not apply to an unpublished draft. */}
            <p className="mb-4">{t('questionDetail.commandWarning')}</p>
          </>
        )}
        {showNote ? (
          <Textarea
            ref={noteInput}
            name="commandNote"
            label={t(
              reasonRequired
                ? 'questionDetail.requiredReason'
                : 'questionDetail.optionalReviewNote'
            )}
            rows={4}
            required={reasonRequired}
            value={note}
            error={noteError}
            disabled={mutation.isPending}
            onChange={(event) => setNote(event.target.value)}
          />
        ) : null}
        {mutation.error || commandStale ? (
          <p className="mt-3" role="alert">
            {commandStale
              ? t('questionDetail.versionConflictDescription')
              : presentError(mutation.error)}
          </p>
        ) : null}
      </Dialog>
    </>
  )
}
