import type { ReactElement } from 'react'
import { getAdminQuestionParamsSchema } from '@nihongo/contracts/admin/content-operations'
import { Button } from '@nihongo/browser/common/components/Button'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { QuestionVersionEditor } from '@app/admin-question/components/QuestionVersionEditor'
import { QuestionVersionPanels } from '@app/admin-question/components/QuestionVersionPanels'
import { questionFieldErrors } from '@app/admin-question/detail/questionWorkflow'
import type { QuestionDetailState } from '@app/admin-question/hooks/useQuestionDetail'

/** Load, error and conflict states, version panels, editor and command sidebar. */
export const QuestionDetailBody = ({
  state
}: {
  state: QuestionDetailState
}): ReactElement => {
  const {
    t,
    presentError,
    commandLabel,
    searchParams,
    setSearchParams,
    workflow,
    detail,
    history,
    selected,
    preview,
    versions,
    heading,
    historyList,
    dirty,
    onDirty,
    editing,
    setEditing,
    editorSnapshot,
    setPending,
    setCommandSnapshot,
    setNote,
    refreshing,
    refreshError,
    conflictRevision,
    mutation,
    conflict,
    candidate,
    commandStale,
    locked,
    commands,
    canEdit,
    refreshSnapshot,
    save,
    questionId
  } = state
  return (
    <>
      {!getAdminQuestionParamsSchema.safeParse({ questionId }).success ? (
        <ErrorState
          title={t('errors.invalidId')}
          description={t('errors.notFound')}
        />
      ) : (
        <>
          {detail.isPending && detail.fetchStatus !== 'paused' ? (
            <LoadingState message={t('questionDetail.loading')} />
          ) : null}
          {workflow.isOffline ||
          detail.isError ||
          history.isError ||
          detail.fetchStatus === 'paused' ||
          refreshError ? (
            <ErrorState
              title={t(
                workflow.isOffline
                  ? 'common.pausedTitle'
                  : 'questionDetail.loadErrorTitle'
              )}
              description={
                workflow.isOffline
                  ? t('common.cachedPausedDescription')
                  : presentError(detail.error ?? history.error)
              }
              retryLabel={t('common.retry')}
              onRetry={() => void refreshSnapshot()}
            />
          ) : null}
          {mutation.error || commandStale ? (
            <div
              role="alert"
              className="my-4 rounded-xl border border-line p-4"
            >
              <p>
                {commandStale
                  ? t('questionDetail.versionConflictDescription')
                  : presentError(mutation.error)}
              </p>
              {conflict || commandStale ? (
                <Button
                  variant="outline"
                  disabled={refreshing || workflow.isOffline}
                  onClick={() => void refreshSnapshot()}
                >
                  {t('questionDetail.retryConflict')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {dirty ? (
            <p className="mb-4 text-sm text-muted">
              {t('questionDetail.dirtyLock')}
            </p>
          ) : null}
          {workflow.unresolved ? (
            <LoadingState message={t('questionDetail.historyLoading')} />
          ) : null}
          {detail.data ? (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
              <div className="min-w-0">
                {selected ? (
                  <QuestionVersionPanels workflow={workflow} />
                ) : !workflow.unresolved ? (
                  <p>{t('questionList.emptyTitle')}</p>
                ) : null}
                {editing && editorSnapshot ? (
                  <div className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
                    <QuestionVersionEditor
                      key={editorSnapshot.preview.question.questionVersionId}
                      preview={
                        selected &&
                        preview.data &&
                        preview.data.question.questionVersionId ===
                          editorSnapshot.preview.question.questionVersionId
                          ? preview.data
                          : editorSnapshot.preview
                      }
                      rowVersion={
                        selected &&
                        preview.data &&
                        preview.data.question.questionVersionId ===
                          editorSnapshot.preview.question.questionVersionId
                          ? selected.rowVersion
                          : editorSnapshot.rowVersion
                      }
                      disabled={locked || !canEdit}
                      isSubmitting={mutation.isPending}
                      conflictRevision={conflictRevision}
                      serverFieldErrors={questionFieldErrors(mutation.error)}
                      onDirtyChange={onDirty}
                      onSubmit={save}
                    />
                  </div>
                ) : null}
              </div>
              <aside className="grid min-w-0 gap-6">
                <section className="rounded-2xl border border-line bg-surface p-5">
                  <h2 className="text-xl font-bold">
                    {t('questionDetail.history')}
                  </h2>
                  <ul ref={historyList} className="mt-4 grid gap-2">
                    {versions.map((version) => (
                      <li key={version.questionVersionId}>
                        <button
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm text-left font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:text-muted"
                          type="button"
                          aria-current={
                            version.questionVersionId ===
                            selected?.questionVersionId
                              ? 'true'
                              : undefined
                          }
                          disabled={
                            dirty ||
                            mutation.isPending ||
                            refreshing ||
                            workflow.isOffline
                          }
                          onClick={() => {
                            const next = new URLSearchParams(searchParams)
                            next.set('version', version.questionVersionId)
                            setEditing(false)
                            setNote('')
                            setPending(null)
                            mutation.reset()
                            setSearchParams(next)
                          }}
                        >
                          <span>
                            {t('common.version')} {version.versionNumber}
                          </span>
                          <Badge>
                            {t(
                              `enums.versionStatuses.${version.versionStatus}`
                            )}
                          </Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {history.hasNextPage ? (
                    <Button
                      variant="outline"
                      className="mt-4"
                      disabled={
                        dirty ||
                        mutation.isPending ||
                        history.isFetching ||
                        workflow.isOffline
                      }
                      isLoading={history.isFetchingNextPage}
                      onClick={() => {
                        const index = versions.length
                        void history.fetchNextPage().then((result) => {
                          if (result.isSuccess && result.fetchStatus === 'idle')
                            requestAnimationFrame(() => {
                              const target = historyList.current?.children
                                .item(index)
                                ?.querySelector('button')
                              if (target) target.focus()
                              else heading.current?.focus()
                            })
                        })
                      }}
                    >
                      {t('questionDetail.historyMore')}
                    </Button>
                  ) : null}
                </section>
                {selected ? (
                  <section className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
                    <h2 className="mb-2 text-xl font-bold">
                      {t('questionDetail.actions')}
                    </h2>
                    <Badge>
                      {t(
                        `enums.lifecycleStatuses.${detail.data.question.lifecycleStatus}`
                      )}
                    </Badge>
                    {commands.map((command) => (
                      <Button
                        key={command}
                        variant={
                          command === 'ARCHIVE' || command === 'RETIRE'
                            ? 'outline'
                            : 'primary'
                        }
                        disabled={locked || dirty || !preview.data}
                        onClick={() => {
                          mutation.reset()
                          setNote('')
                          setCommandSnapshot({
                            questionRowVersion:
                              detail.data!.question.rowVersion,
                            versionRowVersion: selected.rowVersion,
                            versionId: selected.questionVersionId,
                            openCandidateVersionId:
                              command === 'ARCHIVE'
                                ? detail.data!.question.openCandidateVersionId
                                : null,
                            openCandidateRowVersion:
                              command === 'ARCHIVE'
                                ? (candidate?.rowVersion ?? null)
                                : null
                          })
                          setPending(command)
                        }}
                      >
                        {commandLabel(command)}
                      </Button>
                    ))}
                  </section>
                ) : null}
              </aside>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}
