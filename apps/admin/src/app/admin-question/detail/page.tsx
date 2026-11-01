import { useCallback, useMemo, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useBlocker, useParams, useSearchParams } from 'react-router'
import {
  getAdminQuestionParamsSchema,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'
import { Button } from '@nihongo/browser/common/components/Button'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import {
  captureAuthTransitionEpoch,
  assertCurrentAuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { AdminNavigation } from '@app/admin/components/AdminNavigation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useQuestionWorkflow } from '@app/admin-question/hooks/useQuestionWorkflow'
import { useQuestionCommands } from '@app/admin-question/hooks/useQuestionCommands'
import { QuestionVersionEditor } from '@app/admin-question/components/QuestionVersionEditor'
import { QuestionVersionPanels } from '@app/admin-question/components/QuestionVersionPanels'
import {
  allowedCommands,
  buildQuestionCommand,
  editableVersion,
  questionErrorCode,
  questionFieldErrors,
  type QuestionCommand
} from '@app/admin-question/detail/questionWorkflow'
import {
  discardQuestionFreshContext,
  readQuestionFreshContext,
  saveQuestionFreshContext,
  safeQuestionReturn
} from '@app/admin-question/navigation/questionWorkflowContext'
export const AdminQuestionDetailPage = (): ReactElement => {
  const { questionId = '' } = useParams()
  const { user, role } = useAuth()
  const epoch = captureAuthTransitionEpoch()
  return user && role === 'ADMIN' ? (
    <QuestionDetail
      key={`${user.id}:${epoch}:${questionId}`}
      questionId={questionId}
      actorId={user.id}
      epoch={epoch}
    />
  ) : (
    <></>
  )
}
const QuestionDetail = ({
  questionId,
  actorId,
  epoch
}: {
  questionId: string
  actorId: string
  epoch: number
}): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [freshRecovery, setFreshRecovery] = useState<
    'pending' | 'ready' | 'stale'
  >('pending')
  const [freshContext] = useState(() =>
    readQuestionFreshContext(actorId, questionId)
  )
  const rawVersions = searchParams.getAll('version')
  const malformedVersion =
    rawVersions.length > 1 ||
    (rawVersions.length === 1 &&
      !getAdminQuestionParamsSchema.safeParse({ questionId: rawVersions[0] })
        .success)
  const requested = malformedVersion
    ? null
    : searchParams.getAll('version').length === 1
      ? searchParams.get('version')
      : (freshContext?.versionId ?? null)
  const workflow = useQuestionWorkflow(questionId, requested)
  const { detail, history, selected, preview, versions } = workflow
  const returnTo = safeQuestionReturn(
    searchParams.get('returnTo') ?? freshContext?.returnTo
  )
  const heading = useRef<HTMLHeadingElement>(null)
  const historyList = useRef<HTMLUListElement>(null)
  const noteInput = useRef<HTMLTextAreaElement>(null)
  const allowNavigation = useRef(false)
  const recoveryConsumed = useRef(false)
  const [dirty, setDirty] = useState(false)
  const onDirty = useCallback((value: boolean) => setDirty(value), [])
  const [editing, setEditing] = useState(false)
  const [editorSnapshot, setEditorSnapshot] = useState<{
    preview: PreviewQuestionVersionResponse
    rowVersion: number
  } | null>(null)
  const [pending, setPending] = useState<QuestionCommand | null>(null)
  const [commandSnapshot, setCommandSnapshot] = useState<{
    questionRowVersion: number
    versionRowVersion: number
    versionId: string
    openCandidateVersionId: string | null
    openCandidateRowVersion: number | null
  } | null>(null)
  const [note, setNote] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const [conflictRevision, setConflictRevision] = useState(0)
  const mutation = useQuestionCommands(
    (result, request) => {
      setDirty(false)
      setNote('')
      setPending(null)
      discardQuestionFreshContext(actorId, questionId)
      setAnnouncement(
        request.operation === 'updateQuestionVersion'
          ? t('questionDetail.saveComplete')
          : t('questionDetail.commandComplete', {
              command: pending
                ? t(`enums.commands.${pending}`)
                : t('common.details')
            })
      )
      if (
        request.operation === 'createAdminQuestionVersion' &&
        result.questionVersionId
      ) {
        const next = new URLSearchParams(searchParams)
        next.set('version', result.questionVersionId)
        allowNavigation.current = true
        setSearchParams(next)
        allowNavigation.current = false
      }
      heading.current?.focus()
    },
    (error) => {
      if (
        questionFieldErrors(error).reason ||
        questionFieldErrors(error).comment
      )
        noteInput.current?.focus()
    }
  )
  const code = questionErrorCode(mutation.error)
  const conflict = [
    'VERSION_CONFLICT',
    'INVALID_STATE_TRANSITION',
    'QUESTION_VERSION_IMMUTABLE',
    'FORBIDDEN',
    'SEPARATION_OF_DUTIES_VIOLATION'
  ].includes(code ?? '')
  const candidate = versions.find(
    (version) =>
      version.questionVersionId === detail.data?.question.openCandidateVersionId
  )
  const commandStale = Boolean(
    pending &&
      commandSnapshot &&
      (detail.data?.question.rowVersion !==
        commandSnapshot.questionRowVersion ||
        selected?.questionVersionId !== commandSnapshot.versionId ||
        selected?.rowVersion !== commandSnapshot.versionRowVersion ||
        (pending === 'ARCHIVE' &&
          (detail.data?.question.openCandidateVersionId !==
            commandSnapshot.openCandidateVersionId ||
            (candidate?.rowVersion ?? null) !==
              commandSnapshot.openCandidateRowVersion)))
  )
  const locked =
    workflow.locked ||
    refreshing ||
    mutation.isPending ||
    conflict ||
    commandStale
  const commands = useMemo(
    () =>
      detail.data && selected
        ? allowedCommands(detail.data, selected, actorId, candidate)
        : [],
    [detail.data, selected, actorId, candidate]
  )
  const canEdit = Boolean(
    detail.data && selected && editableVersion(detail.data, selected, actorId)
  )
  const unsaved = dirty || note.length > 0 || mutation.isPending
  const blocker = useBlocker(() => !allowNavigation.current && unsaved)
  useEffect(() => {
    if (!unsaved) return
    const stop = (event: BeforeUnloadEvent): void => {
      if (!allowNavigation.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', stop)
    return () => window.removeEventListener('beforeunload', stop)
  }, [unsaved])
  useEffect(() => {
    if (
      malformedVersion ||
      (requested &&
        !workflow.unresolved &&
        !versions.some((version) => version.questionVersionId === requested) &&
        history.isSuccess &&
        !history.hasNextPage)
    ) {
      const next = new URLSearchParams(searchParams)
      next.delete('version')
      setSearchParams(next, { replace: true })
    }
  }, [
    malformedVersion,
    history.hasNextPage,
    history.isSuccess,
    requested,
    searchParams,
    setSearchParams,
    versions,
    workflow.unresolved
  ])
  if (
    freshContext &&
    freshRecovery === 'pending' &&
    detail.data &&
    selected &&
    history.isSuccess &&
    !workflow.unresolved
  ) {
    if (
      freshContext.versionId !== selected.questionVersionId ||
      freshContext.questionRowVersion !== detail.data.question.rowVersion ||
      freshContext.versionRowVersion !== selected.rowVersion ||
      (freshContext.command === 'ARCHIVE' &&
        (freshContext.openCandidateVersionId !==
          detail.data.question.openCandidateVersionId ||
          freshContext.openCandidateRowVersion !==
            (candidate?.rowVersion ?? null))) ||
      !commands.includes(freshContext.command)
    ) {
      setFreshRecovery('stale')
      setAnnouncement(t('questionDetail.versionConflictDescription'))
    } else {
      setFreshRecovery('ready')
      setCommandSnapshot({
        questionRowVersion: freshContext.questionRowVersion,
        versionRowVersion: freshContext.versionRowVersion,
        versionId: freshContext.versionId,
        openCandidateVersionId: freshContext.openCandidateVersionId,
        openCandidateRowVersion: freshContext.openCandidateRowVersion
      })
      setPending(freshContext.command)
      setNote(freshContext.note)
      setAnnouncement(t('freshAssurance.complete'))
    }
  }
  useEffect(() => {
    if (
      !freshContext ||
      freshRecovery === 'pending' ||
      recoveryConsumed.current
    )
      return
    recoveryConsumed.current = true
    discardQuestionFreshContext(actorId, questionId)
    if (freshRecovery === 'ready') {
      const next = new URLSearchParams(searchParams)
      next.set('version', freshContext.versionId)
      next.set('returnTo', returnTo)
      allowNavigation.current = true
      setSearchParams(next, { replace: true })
      allowNavigation.current = false
    }
  }, [
    actorId,
    freshContext,
    freshRecovery,
    questionId,
    returnTo,
    searchParams,
    setSearchParams
  ])
  const refreshSnapshot = async (): Promise<void> => {
    if (workflow.isOffline || mutation.isPending) return
    setRefreshing(true)
    setRefreshError(false)
    try {
      const [latestDetail, latestHistory, latestPreview] = await Promise.all([
        detail.refetch(),
        history.refetch(),
        selected ? preview.refetch() : Promise.resolve(null)
      ])
      if (
        [
          latestDetail,
          latestHistory,
          ...(latestPreview ? [latestPreview] : [])
        ].some((result) => !result.isSuccess || result.fetchStatus !== 'idle')
      )
        throw new Error('Snapshot unavailable')
      const latestVersions =
        latestHistory.data?.pages.flatMap((page) => page.items) ?? []
      const detailVersions = latestDetail.data?.versions.items ?? []
      if (
        latestVersions.some((version) => {
          const detailVersion = detailVersions.find(
            (item) => item.questionVersionId === version.questionVersionId
          )
          return (
            detailVersion && detailVersion.rowVersion !== version.rowVersion
          )
        })
      )
        throw new Error('Snapshot versions disagree')
      const latestCandidate = latestVersions.find(
        (version) =>
          version.questionVersionId ===
          latestDetail.data?.question.openCandidateVersionId
      )
      const latestSelected = latestVersions.find(
        (version) => version.questionVersionId === selected?.questionVersionId
      )
      if (pending && latestDetail.data && latestSelected)
        setCommandSnapshot({
          questionRowVersion: latestDetail.data.question.rowVersion,
          versionRowVersion: latestSelected.rowVersion,
          versionId: latestSelected.questionVersionId,
          openCandidateVersionId:
            pending === 'ARCHIVE'
              ? latestDetail.data.question.openCandidateVersionId
              : null,
          openCandidateRowVersion:
            pending === 'ARCHIVE' ? (latestCandidate?.rowVersion ?? null) : null
        })
      setConflictRevision((value) => value + 1)
      mutation.reset()
      setAnnouncement(t('questionDetail.conflictLoaded'))
      heading.current?.focus()
    } catch {
      setRefreshError(true)
      setAnnouncement(t('questionDetail.conflictLoadFailed'))
    } finally {
      setRefreshing(false)
    }
  }
  const save = async (
    input: UpdateQuestionVersionRequest
  ): Promise<boolean> => {
    if (locked || !canEdit || !selected) return false
    try {
      await mutation.mutateAsync({
        operation: 'updateQuestionVersion',
        params: { versionId: selected.questionVersionId },
        query: {},
        body: input
      })
      return true
    } catch {
      return false
    }
  }
  const fresh = (): void => {
    if (
      !selected ||
      !detail.data ||
      !pending ||
      commandStale ||
      dirty ||
      mutation.isPending
    )
      return
    try {
      assertCurrentAuthActorTransitionFence(
        { actorId, epoch, role: 'ADMIN' },
        useAppStore.getState().currentUser
      )
    } catch {
      return
    }
    if (
      !saveQuestionFreshContext({
        actorId,
        questionId,
        versionId: selected.questionVersionId,
        questionRowVersion: detail.data.question.rowVersion,
        versionRowVersion: selected.rowVersion,
        openCandidateVersionId:
          pending === 'ARCHIVE'
            ? (commandSnapshot?.openCandidateVersionId ?? null)
            : null,
        openCandidateRowVersion:
          pending === 'ARCHIVE'
            ? (commandSnapshot?.openCandidateRowVersion ?? null)
            : null,
        returnTo,
        command: pending,
        note
      })
    ) {
      setAnnouncement(t('errors.generic'))
      return
    }
    allowNavigation.current = true
    appDocumentNavigation.assign(
      '/login?redirect=' + encodeURIComponent('/admin/questions/' + questionId)
    )
  }
  const reasonRequired = pending === 'CHANGE_REQUEST' || pending === 'WITHDRAW'
  const noteLimit = reasonRequired ? 100 : 1000
  const noteError =
    questionFieldErrors(mutation.error).reason ||
    questionFieldErrors(mutation.error).comment
      ? t('errors.validation')
      : [...note].length > noteLimit
        ? t('questionDetail.noteLimit', { formattedCount: String(noteLimit) })
        : undefined
  const showNote =
    pending &&
    ['REQUEST_REVIEW', 'CHANGE_REQUEST', 'APPROVE', 'WITHDRAW'].includes(
      pending
    )
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <AdminNavigation questionListTo={returnTo.slice('/admin'.length)} />
      <Link
        to={returnTo.slice('/admin'.length)}
        className="inline-flex min-h-11 items-center rounded-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {t('common.questions')}
      </Link>
      <header className="my-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            ref={heading}
            tabIndex={-1}
            className="rounded-sm text-3xl font-black"
          >
            {t('questionDetail.title')}
          </h1>
          <p className="mt-3 break-all font-mono text-sm" translate="no">
            {questionId}
          </p>
        </div>
        {canEdit ? (
          <Button
            variant="outline"
            disabled={locked || dirty}
            onClick={() => {
              if (!editing && selected && preview.data) {
                setEditorSnapshot({
                  preview: preview.data,
                  rowVersion: selected.rowVersion
                })
                const next = new URLSearchParams(searchParams)
                next.set('version', selected.questionVersionId)
                setSearchParams(next, { replace: true })
              }
              setEditing((value) => !value)
            }}
          >
            {t(
              editing
                ? 'questionDetail.previewTitle'
                : 'questionDetail.editDraft'
            )}
          </Button>
        ) : null}
      </header>
      <p role="status" className="my-3">
        {announcement}
      </p>
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
                        {t(`enums.commands.${command}`)}
                      </Button>
                    ))}
                  </section>
                ) : null}
              </aside>
            </div>
          ) : null}
        </>
      )}
      <Dialog
        open={pending !== null}
        title={
          pending
            ? t('questionDetail.commandDialogTitle', {
                command: t(`enums.commands.${pending}`)
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
        <p className="mb-4">{t('questionDetail.commandWarning')}</p>
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
    </section>
  )
}
