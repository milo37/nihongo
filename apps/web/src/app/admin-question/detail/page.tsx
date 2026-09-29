import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { ReactElement } from 'react'
import {
  updateQuestionVersionRequestSchema,
  type AdminQuestionVersionSummary,
  type CreateAdminQuestionRequest,
  type DiffQuestionVersionResponse,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import {
  adminCommandKey,
  adminDiffFieldKey,
  adminDifficultyKey,
  adminLifecycleStatusKey,
  adminQuestionTypeKey,
  adminReviewActionKey,
  adminSubjectKey,
  adminVersionStatusKey,
  getFreshAssuranceReasonCode
} from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import {
  isPhase7UiApiError,
  usePhase7AdminQuestionCommand,
  useUpdatePhase7AdminQuestionVersion,
  type Phase7AdminQuestionCommand,
  type Phase7AdminQuestionCommandInput
} from '@app/admin-question/hooks/usePhase7AdminMutations'
import {
  usePhase7AdminQuestionDetail,
  usePhase7AdminQuestionDiff,
  usePhase7AdminQuestionPreview,
  usePhase7AdminQuestionReviewConnection,
  usePhase7AdminQuestionVersions
} from '@app/admin-question/hooks/usePhase7AdminQueries'
import { FreshAssuranceDialog } from '@app/admin-question/components/FreshAssuranceDialog'
import { Phase7QuestionEditor } from '@app/admin-question/components/Phase7QuestionEditor'
import { refreshPhase7ConflictSnapshot } from '@app/admin-question/detail/phase7ConflictRefreshFence'
import { useFreshAssurance } from '@app/admin-question/hooks/useFreshAssurance'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Textarea } from '@common/components/Textarea'

const sensitiveCommands = new Set<Phase7AdminQuestionCommand>([
  'APPROVE',
  'ARCHIVE',
  'PUBLISH',
  'RETIRE',
  'WITHDRAW'
])

type DiffChange = DiffQuestionVersionResponse['changes'][number]

const DiffValue = ({
  change,
  side
}: {
  readonly change: DiffChange
  readonly side: 'after' | 'before'
}): ReactElement => {
  const { t } = useAdminPresentation()
  if (change.kind === 'OPTIONS') {
    const options = change[side]
    return (
      <ol className="grid gap-2">
        {options.map((option) => (
          <li className="break-words" key={option.ordinal} lang="ja">
            {option.ordinal}. {option.text}
            {option.isCorrect ? t('questionDetail.correctSuffix') : ''}
          </li>
        ))}
      </ol>
    )
  }
  if (change.kind === 'TAGS') {
    const tags = change[side]
    return (
      <ul className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <li
            className="rounded-full border border-slate-300 bg-white px-2 py-1 text-sm"
            key={tag.id}
          >
            {tag.label}
          </li>
        ))}
      </ul>
    )
  }
  const value = change[side]
  const presentedValue = (() => {
    if (typeof value !== 'string') return t('common.none')
    if (change.field === 'SUBJECT' && value in adminSubjectKey) {
      return t(adminSubjectKey[value as keyof typeof adminSubjectKey])
    }
    if (change.field === 'QUESTION_TYPE' && value in adminQuestionTypeKey) {
      return t(adminQuestionTypeKey[value as keyof typeof adminQuestionTypeKey])
    }
    if (change.field === 'DIFFICULTY' && value in adminDifficultyKey) {
      return t(adminDifficultyKey[value as keyof typeof adminDifficultyKey])
    }
    return value
  })()
  const language =
    change.field === 'EXPLANATION_KO'
      ? 'ko'
      : change.field === 'EXPLANATION_JA' ||
          change.field === 'PASSAGE' ||
          change.field === 'QUESTION_TEXT'
        ? 'ja'
        : undefined
  return (
    <p className="whitespace-pre-wrap break-words" lang={language}>
      {presentedValue}
    </p>
  )
}

export const Phase7QuestionVersionDiff = ({
  value
}: {
  readonly value: DiffQuestionVersionResponse
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <ul
      className="mt-4 grid gap-4"
      aria-label={t('questionDetail.diffListLabel')}
    >
      {value.changes.map((change) => {
        const label = t(adminDiffFieldKey[change.field])
        return (
          <li
            className="rounded-lg border border-slate-200 bg-white p-4"
            key={change.field}
          >
            <h4 className="font-bold">{label}</h4>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <section
                aria-label={t('questionDetail.diffBeforeLabel', {
                  field: label
                })}
              >
                <h5 className="text-sm font-semibold text-muted">
                  {t('questionDetail.diffBefore')}
                </h5>
                <div className="mt-1">
                  <DiffValue change={change} side="before" />
                </div>
              </section>
              <section
                aria-label={t('questionDetail.diffAfterLabel', {
                  field: label
                })}
              >
                <h5 className="text-sm font-semibold text-muted">
                  {t('questionDetail.diffAfter')}
                </h5>
                <div className="mt-1">
                  <DiffValue change={change} side="after" />
                </div>
              </section>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const commandForStatus = (
  status: AdminQuestionVersionSummary['versionStatus']
): readonly Phase7AdminQuestionCommand[] => {
  switch (status) {
    case 'DRAFT':
    case 'CHANGES_REQUESTED':
      return ['REQUEST_REVIEW']
    case 'IN_REVIEW':
      return ['CHANGE_REQUEST', 'APPROVE']
    case 'APPROVED':
      return ['WITHDRAW', 'PUBLISH']
    case 'PUBLISHED':
      return ['RETIRE']
    case 'RETIRED':
      return []
  }
}

type Phase7ReadOnlyPreviewProps = {
  readonly preview: PreviewQuestionVersionResponse
  readonly versionStatus: AdminQuestionVersionSummary['versionStatus']
}

const Phase7ReadOnlyPreview = ({
  preview,
  versionStatus
}: Phase7ReadOnlyPreviewProps): ReactElement => {
  const { t } = useAdminPresentation()
  const answer =
    preview.question.options.find(
      (option) => option.id === preview.adminAnswer.correctOptionId
    )?.label ?? preview.adminAnswer.correctOptionId
  return (
    <article className="rounded-2xl border border-line bg-white p-6">
      <h2 className="text-xl font-bold">{t('questionDetail.previewTitle')}</h2>
      <p className="mt-2 text-sm text-muted">
        {t('questionDetail.previewDescription', {
          status: t(adminVersionStatusKey[versionStatus])
        })}
      </p>
      <h3 className="mt-5 break-words text-lg font-bold" lang="ja">
        {preview.question.questionText}
      </h3>
      {preview.question.passage ? (
        <p
          className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4"
          lang="ja"
        >
          {preview.question.passage}
        </p>
      ) : null}
      <ol className="mt-4 grid gap-2" lang="ja">
        {preview.question.options.map((option) => (
          <li
            className="break-words rounded-lg border border-line p-3"
            key={option.id}
          >
            {option.label}. {option.text}
          </li>
        ))}
      </ol>
      <section className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-4">
        <h3 className="font-bold">{t('questionDetail.answerExplanation')}</h3>
        <p className="mt-2">{t('questionDetail.answer', { answer })}</p>
        <p className="mt-2 whitespace-pre-wrap break-words" lang="ko">
          {preview.adminAnswer.explanationKo}
        </p>
      </section>
    </article>
  )
}

export const AdminQuestionDetailPage = (): ReactElement => {
  const {
    formatAdminDateTime,
    formatAdminNumber,
    presentError,
    presentFieldError,
    t
  } = useAdminPresentation()
  const { questionId = '' } = useParams()
  const freshAssurance = useFreshAssurance()
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [commandNote, setCommandNote] = useState('')
  const [pendingCommand, setPendingCommand] =
    useState<Phase7AdminQuestionCommand | null>(null)
  const [announcement, setAnnouncement] = useState<
    | { readonly command: Phase7AdminQuestionCommand; readonly kind: 'COMMAND' }
    | { readonly kind: 'CONFLICT_FAILED' | 'CONFLICT_LOADED' | 'SAVED' }
    | null
  >(null)
  const [rowVersionRevision, setRowVersionRevision] = useState(0)
  const [conflictRefreshFailed, setConflictRefreshFailed] = useState(false)
  const [isEditorDirty, setEditorDirty] = useState(false)
  const commandNoteRef = useRef<HTMLTextAreaElement>(null)
  const commandConfirmRef = useRef<HTMLButtonElement>(null)
  const workflowHeadingRef = useRef<HTMLHeadingElement>(null)
  const detail = usePhase7AdminQuestionDetail(questionId)
  const versionHistory = usePhase7AdminQuestionVersions(
    questionId,
    20,
    Boolean(detail.data)
  )
  const versions =
    versionHistory.data?.pages.flatMap((page) => page.items) ??
    detail.data?.versions.items ??
    []
  const effectiveSelectedVersionId =
    selectedVersionId ||
    detail.data?.question.openCandidateVersionId ||
    detail.data?.question.currentPublishedVersionId ||
    detail.data?.versions.items[0]?.questionVersionId ||
    ''

  const selectedVersion = versions.find(
    (version) => version.questionVersionId === effectiveSelectedVersionId
  )
  const selectedIndex = selectedVersion
    ? versions.findIndex(
        (version) =>
          version.questionVersionId === selectedVersion.questionVersionId
      )
    : -1
  const baseVersion =
    selectedIndex >= 0 ? versions[selectedIndex + 1] : undefined
  const selectedQuestionVersionId = selectedVersion?.questionVersionId ?? ''
  const preview = usePhase7AdminQuestionPreview(
    selectedQuestionVersionId,
    Boolean(selectedVersion)
  )
  const reviews = usePhase7AdminQuestionReviewConnection(
    selectedQuestionVersionId,
    20,
    Boolean(selectedVersion)
  )
  const reviewItems = reviews.data?.pages.flatMap((page) => page.items) ?? []
  const diff = usePhase7AdminQuestionDiff(
    selectedQuestionVersionId,
    {
      baseVersionId: baseVersion?.questionVersionId ?? 'no-base-version'
    },
    Boolean(selectedVersion && baseVersion)
  )
  const openCandidate = versions.find(
    (candidate) =>
      candidate.questionVersionId ===
      detail.data?.question.openCandidateVersionId
  )

  const commandMutation = usePhase7AdminQuestionCommand({
    currentPublishedVersionId:
      detail.data?.question.currentPublishedVersionId ?? null,
    openCandidateVersionId:
      detail.data?.question.openCandidateVersionId ?? null,
    openCandidateVersionRowVersion: openCandidate?.rowVersion ?? null,
    preview: preview.data,
    onSuccess: (_result, variables) => {
      setCommandNote('')
      setPendingCommand(null)
      setAnnouncement({ command: variables.command, kind: 'COMMAND' })
    },
    onError: (error, variables) => {
      const hasCommandFieldError =
        isPhase7UiApiError(error) &&
        error.code === 'VALIDATION_ERROR' &&
        Object.values(error.fieldErrors ?? {}).some(
          (messages) => messages.length > 0
        )
      if (!hasCommandFieldError) setPendingCommand(null)
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      ) {
        const reasonCode = getFreshAssuranceReasonCode(variables.command)
        if (!reasonCode) return
        freshAssurance.open({
          questionIds: [questionId],
          reasonCode
        })
      }
    }
  })

  const updateVersion = useUpdatePhase7AdminQuestionVersion(
    questionId,
    effectiveSelectedVersionId,
    () => {
      setAnnouncement({ kind: 'SAVED' })
    }
  )

  const requiresNote =
    pendingCommand === 'CHANGE_REQUEST' || pendingCommand === 'WITHDRAW'
  const commandNoteScalarLimit = requiresNote ? 100 : 1000
  const commandNoteLengthError =
    [...commandNote].length > commandNoteScalarLimit
      ? t('questionDetail.noteLimit', {
          formattedCount: formatAdminNumber(commandNoteScalarLimit)
        })
      : undefined

  const commandFieldErrors =
    commandMutation.error && isPhase7UiApiError(commandMutation.error)
      ? commandMutation.error.fieldErrors
      : undefined
  const commandNoteError =
    presentFieldError(commandFieldErrors?.reason) ??
    presentFieldError(commandFieldErrors?.comment) ??
    commandNoteLengthError

  useEffect(() => {
    if (!pendingCommand || !commandMutation.error || !commandFieldErrors) return
    if (commandNoteError) commandNoteRef.current?.focus()
    else commandConfirmRef.current?.focus()
  }, [
    commandFieldErrors,
    commandMutation.error,
    commandNoteError,
    pendingCommand
  ])

  const handleEditorSubmit = async (
    input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
  ): Promise<void> => {
    await updateVersion.mutateAsync(
      updateQuestionVersionRequestSchema.parse(input)
    )
  }

  const refreshAfterConflict = async (): Promise<void> => {
    setConflictRefreshFailed(false)
    try {
      await refreshPhase7ConflictSnapshot({
        questionVersionId: effectiveSelectedVersionId,
        refetchDetail: detail.refetch,
        refetchHistory: versionHistory.refetch,
        refetchPreview: preview.refetch,
        ...(baseVersion ? { refetchDiff: diff.refetch } : {})
      })
      updateVersion.reset()
      setRowVersionRevision((revision) => revision + 1)
      setAnnouncement({ kind: 'CONFLICT_LOADED' })
    } catch {
      setConflictRefreshFailed(true)
      setAnnouncement({ kind: 'CONFLICT_FAILED' })
    }
  }

  const openCommand = (command: Phase7AdminQuestionCommand): void => {
    if (commandMutation.isPending) return
    commandMutation.reset()
    setCommandNote('')
    setPendingCommand(command)
  }

  const closeCommand = (): void => {
    if (commandMutation.isPending) return
    commandMutation.reset()
    setCommandNote('')
    setPendingCommand(null)
  }

  const visibleCommands = selectedVersion
    ? commandForStatus(selectedVersion.versionStatus)
    : []
  const canConfirm =
    (!requiresNote || commandNote.trim().length > 0) &&
    commandNoteLengthError === undefined

  const commandInput: Phase7AdminQuestionCommandInput | null =
    pendingCommand && selectedVersion && detail.data
      ? {
          command: pendingCommand,
          note: commandNote,
          questionId,
          questionRowVersion: detail.data.question.rowVersion,
          version: selectedVersion
        }
      : null

  const isDetailPaused = detail.fetchStatus === 'paused'
  const isVersionHistoryPaused = versionHistory.fetchStatus === 'paused'
  const isPreviewPaused = preview.fetchStatus === 'paused'
  const isReviewPaused = reviews.fetchStatus === 'paused'
  const writesLocked =
    isDetailPaused ||
    detail.isError ||
    detail.isFetching ||
    isVersionHistoryPaused ||
    versionHistory.isError ||
    isPreviewPaused ||
    preview.isError

  if (detail.isPending && !detail.data && isDetailPaused) {
    return (
      <ErrorState
        autoFocus
        description={t('common.pausedDescription')}
        headingLevel={1}
        onRetry={() => void detail.refetch()}
        title={t('common.pausedTitle')}
      />
    )
  }
  if (detail.isPending && !detail.data) {
    return <LoadingState message={t('questionDetail.loading')} />
  }
  if (!detail.data) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <ErrorState
          autoFocus
          description={presentError(detail.error)}
          headingLevel={1}
          onRetry={() => void detail.refetch()}
          title={t('questionDetail.loadErrorTitle')}
        />
      </section>
    )
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label={t('common.breadcrumbLabel')}>
        <Link
          className="font-semibold text-brand underline"
          to="/admin/questions"
        >
          {t('common.questions')}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">{t('common.questionDetail')}</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>
            {t(adminLifecycleStatusKey[detail.data.question.lifecycleStatus])}
          </Badge>
          <span className="font-mono text-xs text-muted">{questionId}</span>
        </div>
        <h1
          ref={workflowHeadingRef}
          className="mt-3 text-3xl font-black"
          tabIndex={-1}
        >
          {t('questionDetail.title')}
        </h1>
        <p className="mt-3 text-muted">{t('questionDetail.description')}</p>
      </header>

      {detail.isError || isDetailPaused ? (
        <div
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="alert"
        >
          <p className="font-semibold">
            {isDetailPaused
              ? t('common.cachedPausedDescription')
              : t('questionDetail.cachedError')}
          </p>
          <p className="mt-1 text-sm">
            {isDetailPaused
              ? t('common.pausedDescription')
              : presentError(detail.error)}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void detail.refetch()}
          >
            {t('questionDetail.retryDetail')}
          </Button>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="rounded-2xl border border-line bg-white p-4">
          <h2 className="text-lg font-bold">{t('questionDetail.history')}</h2>
          {versionHistory.isError || isVersionHistoryPaused ? (
            <div className="mt-3 text-sm" role="alert">
              <p>
                {isVersionHistoryPaused
                  ? t('common.cachedPausedDescription')
                  : presentError(versionHistory.error)}
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() => void versionHistory.refetch()}
              >
                {t('common.retry')}
              </Button>
            </div>
          ) : null}
          <ul className="mt-4 grid gap-2">
            {versions.map((version) => (
              <li key={version.questionVersionId}>
                <button
                  className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left ${
                    version.questionVersionId === effectiveSelectedVersionId
                      ? 'border-brand bg-emerald-50'
                      : 'border-line hover:bg-slate-50'
                  }`}
                  type="button"
                  aria-current={
                    version.questionVersionId === effectiveSelectedVersionId
                      ? 'true'
                      : undefined
                  }
                  disabled={
                    commandMutation.isPending ||
                    (isEditorDirty &&
                      version.questionVersionId !== effectiveSelectedVersionId)
                  }
                  onClick={() =>
                    setSelectedVersionId(version.questionVersionId)
                  }
                >
                  <span className="block font-bold">
                    v{formatAdminNumber(version.versionNumber)} ·{' '}
                    {t(adminVersionStatusKey[version.versionStatus])}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {version.questionTextPreview}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {versionHistory.hasNextPage ? (
            <Button
              className="mt-4"
              disabled={
                versionHistory.isFetchingNextPage ||
                versionHistory.isError ||
                isVersionHistoryPaused
              }
              fullWidth
              variant="outline"
              onClick={() => void versionHistory.fetchNextPage()}
            >
              {t(
                versionHistory.isFetchingNextPage
                  ? 'questionDetail.historyLoading'
                  : 'questionDetail.historyMore'
              )}
            </Button>
          ) : null}
          {detail.data.question.openCandidateVersionId === null &&
          selectedVersion &&
          preview.data ? (
            <Button
              className="mt-4"
              disabled={
                isEditorDirty || writesLocked || commandMutation.isPending
              }
              fullWidth
              variant="outline"
              onClick={() => openCommand('CREATE_VERSION')}
            >
              {t('questionDetail.newDraft')}
            </Button>
          ) : null}
          {detail.data.question.lifecycleStatus === 'ACTIVE' &&
          selectedVersion ? (
            <Button
              className="mt-2"
              disabled={
                isEditorDirty || writesLocked || commandMutation.isPending
              }
              fullWidth
              variant="danger"
              onClick={() => openCommand('ARCHIVE')}
            >
              {t('questionDetail.archive')}
            </Button>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-6">
          {selectedVersion ? (
            <div className="rounded-2xl border border-line bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">
                    v{formatAdminNumber(selectedVersion.versionNumber)} ·{' '}
                    {t(adminVersionStatusKey[selectedVersion.versionStatus])}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    rowVersion {selectedVersion.rowVersion}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {visibleCommands.map((command) => (
                    <Button
                      key={command}
                      disabled={
                        isEditorDirty ||
                        writesLocked ||
                        commandMutation.isPending
                      }
                      variant={
                        sensitiveCommands.has(command) ? 'dark' : 'outline'
                      }
                      onClick={() => openCommand(command)}
                    >
                      {t(adminCommandKey[command])}
                    </Button>
                  ))}
                </div>
              </div>
              {isEditorDirty ? (
                <p className="mt-3 text-sm font-semibold text-amber-800">
                  {t('questionDetail.dirtyLock')}
                </p>
              ) : null}
              {baseVersion ? (
                <div
                  className="mt-4 rounded-xl bg-slate-50 p-4"
                  aria-live="polite"
                >
                  <strong>{t('questionDetail.diffTitle')}</strong>
                  <p className="mt-1 text-sm text-muted">
                    {diff.isPending
                      ? t('questionDetail.diffLoading')
                      : diff.isError
                        ? t('questionDetail.diffError')
                        : diff.data?.changedFields.length
                          ? diff.data.changedFields
                              .map((field) => t(adminDiffFieldKey[field]))
                              .join(', ')
                          : t('questionDetail.diffEmpty')}
                  </p>
                  {diff.data && diff.data.changes.length > 0 ? (
                    <Phase7QuestionVersionDiff value={diff.data} />
                  ) : null}
                  {diff.isError ? (
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      onClick={() => void diff.refetch()}
                    >
                      {t('questionDetail.retryDiff')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {preview.isPending && !preview.data && isPreviewPaused ? (
            <ErrorState
              description={t('common.pausedDescription')}
              onRetry={() => void preview.refetch()}
              title={t('common.pausedTitle')}
            />
          ) : preview.isPending && !preview.data ? (
            <LoadingState message={t('questionDetail.previewLoading')} />
          ) : !preview.data || !selectedVersion ? (
            <ErrorState
              description={presentError(preview.error)}
              onRetry={() => void preview.refetch()}
              title={t('questionDetail.previewErrorTitle')}
            />
          ) : (
            <>
              {preview.isError || isPreviewPaused ? (
                <div
                  className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
                  role="alert"
                >
                  <p className="font-semibold">
                    {isPreviewPaused
                      ? t('common.cachedPausedDescription')
                      : t('questionDetail.previewCachedError')}
                  </p>
                  <p className="mt-1 text-sm">
                    {isPreviewPaused
                      ? t('common.pausedDescription')
                      : presentError(preview.error)}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => void preview.refetch()}
                  >
                    {t('questionDetail.retryPreview')}
                  </Button>
                </div>
              ) : null}
              {selectedVersion.versionStatus === 'DRAFT' ||
              selectedVersion.versionStatus === 'CHANGES_REQUESTED' ? (
                <>
                  <Phase7QuestionEditor
                    key={selectedVersion.questionVersionId}
                    expectedRowVersion={selectedVersion.rowVersion}
                    initialPreview={preview.data}
                    isSubmitting={updateVersion.isPending}
                    mode="update"
                    requiresConflictResolution={
                      writesLocked ||
                      Boolean(
                        updateVersion.error &&
                          isPhase7UiApiError(updateVersion.error) &&
                          updateVersion.error.code === 'VERSION_CONFLICT'
                      )
                    }
                    rowVersionRevision={rowVersionRevision}
                    serverFieldErrors={
                      updateVersion.error &&
                      isPhase7UiApiError(updateVersion.error)
                        ? updateVersion.error.fieldErrors
                        : undefined
                    }
                    serverMessage={
                      updateVersion.error
                        ? presentError(updateVersion.error)
                        : undefined
                    }
                    submitLabel={t('questionDetail.saveDraft')}
                    onDirtyChange={setEditorDirty}
                    onSubmit={handleEditorSubmit}
                  />
                  <Phase7ReadOnlyPreview
                    preview={preview.data}
                    versionStatus={selectedVersion.versionStatus}
                  />
                </>
              ) : (
                <Phase7ReadOnlyPreview
                  preview={preview.data}
                  versionStatus={selectedVersion.versionStatus}
                />
              )}
            </>
          )}

          {updateVersion.error &&
          isPhase7UiApiError(updateVersion.error) &&
          updateVersion.error.code === 'VERSION_CONFLICT' ? (
            <ErrorState
              description={
                conflictRefreshFailed
                  ? t('questionDetail.conflictLoadFailed')
                  : t('questionDetail.versionConflictDescription')
              }
              title={t('questionDetail.versionConflictTitle')}
              action={
                <Button onClick={() => void refreshAfterConflict()}>
                  {t('questionDetail.retryConflict')}
                </Button>
              }
            />
          ) : null}

          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-xl font-bold">{t('questionDetail.reviews')}</h2>
            {(reviews.isError || isReviewPaused) && reviews.data ? (
              <div
                className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
                role="alert"
              >
                <p className="font-semibold">
                  {isReviewPaused
                    ? t('common.cachedPausedDescription')
                    : t('questionDetail.reviewsCachedError')}
                </p>
                <p className="mt-1 text-sm">
                  {isReviewPaused
                    ? t('common.pausedDescription')
                    : presentError(reviews.error)}
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => void reviews.refetch()}
                >
                  {t('questionDetail.retryReviews')}
                </Button>
              </div>
            ) : null}
            {reviews.isPending && !reviews.data && isReviewPaused ? (
              <ErrorState
                description={t('common.pausedDescription')}
                onRetry={() => void reviews.refetch()}
                title={t('common.pausedTitle')}
              />
            ) : reviews.isPending && !reviews.data ? (
              <LoadingState message={t('questionDetail.reviewsLoading')} />
            ) : !reviews.data ? (
              <ErrorState
                description={presentError(reviews.error)}
                onRetry={() => void reviews.refetch()}
                title={t('questionDetail.reviewsErrorTitle')}
              />
            ) : reviewItems.length ? (
              <ol className="mt-4 grid gap-3">
                {reviewItems.map((review) => (
                  <li
                    className="rounded-xl border border-line p-4"
                    key={review.id}
                  >
                    <strong>{t(adminReviewActionKey[review.action])}</strong>
                    <time
                      className="ml-2 text-sm text-muted"
                      dateTime={review.occurredAt}
                    >
                      {formatAdminDateTime(review.occurredAt)}
                    </time>
                    {review.comment ? (
                      <p className="mt-2 whitespace-pre-wrap">
                        {review.comment}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-muted">
                {t('questionDetail.reviewsEmpty')}
              </p>
            )}
            {reviews.hasNextPage ? (
              <Button
                className="mt-4"
                disabled={
                  reviews.isFetchingNextPage ||
                  reviews.isError ||
                  isReviewPaused
                }
                variant="outline"
                onClick={() => void reviews.fetchNextPage()}
              >
                {t(
                  reviews.isFetchingNextPage
                    ? 'questionDetail.reviewsMoreLoading'
                    : 'questionDetail.reviewsMore'
                )}
              </Button>
            ) : null}
          </section>
        </div>
      </div>

      {commandMutation.error ? (
        <ErrorState
          className="mt-6"
          description={presentError(commandMutation.error)}
          title={t('questionDetail.commandFailedTitle')}
          action={
            isPhase7UiApiError(commandMutation.error) &&
            commandMutation.error.code === 'VERSION_CONFLICT' ? (
              <Button onClick={() => void refreshAfterConflict()}>
                {t('questionDetail.retryConflict')}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announcement?.kind === 'COMMAND'
          ? t('questionDetail.commandComplete', {
              command: t(adminCommandKey[announcement.command])
            })
          : announcement?.kind === 'SAVED'
            ? t('questionDetail.saveComplete')
            : announcement?.kind === 'CONFLICT_LOADED'
              ? t('questionDetail.conflictLoaded')
              : announcement?.kind === 'CONFLICT_FAILED'
                ? t('questionDetail.conflictLoadFailed')
                : ''}
      </p>
      {freshAssurance.completionMessage ? (
        <p
          className="mt-6 rounded-xl border border-success-line bg-success-soft p-4 font-semibold text-success-strong"
          role="status"
        >
          {freshAssurance.completionMessage}
        </p>
      ) : null}

      <Dialog
        fallbackFocusRef={workflowHeadingRef}
        initialFocusRef={
          pendingCommand === 'CHANGE_REQUEST' ||
          pendingCommand === 'WITHDRAW' ||
          pendingCommand === 'REQUEST_REVIEW' ||
          pendingCommand === 'APPROVE'
            ? commandNoteRef
            : commandConfirmRef
        }
        open={pendingCommand !== null}
        preventClose={commandMutation.isPending}
        title={
          pendingCommand
            ? t('questionDetail.commandDialogTitle', {
                command: t(adminCommandKey[pendingCommand])
              })
            : t('questionDetail.commandDialogFallbackTitle')
        }
        description={t('questionDetail.commandDialogDescription')}
        onOpenChange={(open) => {
          if (!open) closeCommand()
        }}
        footer={
          <>
            <Button
              disabled={commandMutation.isPending}
              variant="outline"
              onClick={closeCommand}
            >
              {t('questionDetail.cancel')}
            </Button>
            <Button
              ref={commandConfirmRef}
              disabled={
                commandMutation.isPending ||
                writesLocked ||
                !canConfirm ||
                !commandInput
              }
              isLoading={commandMutation.isPending}
              variant={pendingCommand === 'ARCHIVE' ? 'danger' : 'primary'}
              onClick={() => {
                if (!commandMutation.isPending && commandInput) {
                  commandMutation.mutate(commandInput)
                }
              }}
            >
              {t('questionDetail.execute')}
            </Button>
          </>
        }
      >
        {pendingCommand === 'CHANGE_REQUEST' ||
        pendingCommand === 'WITHDRAW' ||
        pendingCommand === 'REQUEST_REVIEW' ||
        pendingCommand === 'APPROVE' ? (
          <Textarea
            ref={commandNoteRef}
            disabled={commandMutation.isPending}
            error={commandNoteError}
            label={
              requiresNote
                ? t('questionDetail.requiredReason')
                : t('questionDetail.optionalReviewNote')
            }
            maxLength={commandNoteScalarLimit * 2}
            name="command-note"
            required={requiresNote}
            rows={4}
            value={commandNote}
            onChange={(event) => setCommandNote(event.currentTarget.value)}
          />
        ) : (
          <p className="leading-7">{t('questionDetail.commandWarning')}</p>
        )}
      </Dialog>
      <FreshAssuranceDialog controller={freshAssurance} />
    </section>
  )
}
