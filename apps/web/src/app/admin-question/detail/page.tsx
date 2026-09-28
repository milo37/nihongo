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

const commandLabel: Record<Phase7AdminQuestionCommand, string> = {
  APPROVE: '승인',
  ARCHIVE: '문제 보관',
  CHANGE_REQUEST: '수정 요청',
  CREATE_VERSION: '새 버전 만들기',
  PUBLISH: '공개',
  REQUEST_REVIEW: '검수 요청',
  RETIRE: '공개 중단',
  WITHDRAW: '승인 철회'
}

const diffFieldLabel: Record<
  DiffQuestionVersionResponse['changes'][number]['field'],
  string
> = {
  LEVEL: '급수',
  SUBJECT: '과목',
  QUESTION_TYPE: '문제 유형',
  DIFFICULTY: '난이도',
  PASSAGE: '지문',
  QUESTION_TEXT: '문제 문장',
  EXPLANATION_KO: '한국어 해설',
  EXPLANATION_JA: '일본어 해설',
  OPTIONS: '선택지와 정답',
  TAGS: '태그'
}

type DiffChange = DiffQuestionVersionResponse['changes'][number]

const DiffValue = ({
  change,
  side
}: {
  readonly change: DiffChange
  readonly side: 'after' | 'before'
}): ReactElement => {
  if (change.kind === 'OPTIONS') {
    const options = change[side]
    return (
      <ol className="grid gap-2">
        {options.map((option) => (
          <li className="break-words" key={option.ordinal}>
            {option.ordinal}. {option.text}
            {option.isCorrect ? ' (정답)' : ''}
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
  return (
    <p className="whitespace-pre-wrap break-words">
      {typeof value === 'string' ? value : '없음'}
    </p>
  )
}

export const Phase7QuestionVersionDiff = ({
  value
}: {
  readonly value: DiffQuestionVersionResponse
}): ReactElement => (
  <ul className="mt-4 grid gap-4" aria-label="버전별 변경 내용">
    {value.changes.map((change) => {
      const label = diffFieldLabel[change.field]
      return (
        <li
          className="rounded-lg border border-slate-200 bg-white p-4"
          key={change.field}
        >
          <h4 className="font-bold">{label}</h4>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <section aria-label={`${label} 변경 전`}>
              <h5 className="text-sm font-semibold text-muted">변경 전</h5>
              <div className="mt-1">
                <DiffValue change={change} side="before" />
              </div>
            </section>
            <section aria-label={`${label} 변경 후`}>
              <h5 className="text-sm font-semibold text-muted">변경 후</h5>
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

const errorText = (error: unknown): string => {
  if (!isPhase7UiApiError(error)) {
    return '관리자 작업을 완료하지 못했습니다.'
  }
  const message = error.serverMessage ?? error.message
  return error.retryAfterMs
    ? `${message} ${Math.ceil(error.retryAfterMs / 1000)}초 뒤 다시 시도해 주세요.`
    : message
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
}: Phase7ReadOnlyPreviewProps): ReactElement => (
  <article className="rounded-2xl border border-line bg-white p-6">
    <h2 className="text-xl font-bold">학습자 공개 화면 미리보기</h2>
    <p className="mt-2 text-sm text-muted">
      {versionStatus} 버전의 public projection을 읽기 전용으로 표시합니다.
    </p>
    <h3 className="mt-5 text-lg font-bold">{preview.question.questionText}</h3>
    {preview.question.passage ? (
      <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4">
        {preview.question.passage}
      </p>
    ) : null}
    <ol className="mt-4 grid gap-2">
      {preview.question.options.map((option) => (
        <li className="rounded-lg border border-line p-3" key={option.id}>
          {option.label}. {option.text}
        </li>
      ))}
    </ol>
    <section className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-4">
      <h3 className="font-bold">관리자 정답·해설</h3>
      <p className="mt-2">
        정답:{' '}
        {preview.question.options.find(
          (option) => option.id === preview.adminAnswer.correctOptionId
        )?.label ?? preview.adminAnswer.correctOptionId}
      </p>
      <p className="mt-2 whitespace-pre-wrap">
        {preview.adminAnswer.explanationKo}
      </p>
    </section>
  </article>
)

export const AdminQuestionDetailPage = (): ReactElement => {
  const { questionId = '' } = useParams()
  const freshAssurance = useFreshAssurance()
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [commandNote, setCommandNote] = useState('')
  const [pendingCommand, setPendingCommand] =
    useState<Phase7AdminQuestionCommand | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [rowVersionRevision, setRowVersionRevision] = useState(0)
  const [conflictRefreshError, setConflictRefreshError] = useState<string>()
  const [isEditorDirty, setEditorDirty] = useState(false)
  const commandNoteRef = useRef<HTMLTextAreaElement>(null)
  const commandConfirmRef = useRef<HTMLButtonElement>(null)
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
      setAnnouncement(`${commandLabel[variables.command]} 작업이 완료됐습니다.`)
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
        freshAssurance.open({
          questionIds: [questionId],
          reason: `${commandLabel[variables.command]} 작업은 민감한 관리자 작업입니다.`
        })
      }
    }
  })

  const updateVersion = useUpdatePhase7AdminQuestionVersion(
    questionId,
    effectiveSelectedVersionId,
    () => {
      setAnnouncement('초안 변경사항을 저장했습니다.')
    }
  )

  const requiresNote =
    pendingCommand === 'CHANGE_REQUEST' || pendingCommand === 'WITHDRAW'
  const commandNoteScalarLimit = requiresNote ? 100 : 1000
  const commandNoteLengthError =
    [...commandNote].length > commandNoteScalarLimit
      ? `메모는 ${commandNoteScalarLimit}자 이하여야 합니다.`
      : undefined

  const commandFieldErrors =
    commandMutation.error && isPhase7UiApiError(commandMutation.error)
      ? commandMutation.error.fieldErrors
      : undefined
  const commandNoteError =
    commandFieldErrors?.reason?.[0] ??
    commandFieldErrors?.comment?.[0] ??
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
    setConflictRefreshError(undefined)
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
      setAnnouncement(
        '서버의 최신 rowVersion과 차이를 불러왔습니다. 로컬 편집 내용은 유지됩니다.'
      )
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : '최신 버전을 확인하지 못했습니다.'
      setConflictRefreshError(message)
      setAnnouncement(message)
    }
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

  if (detail.isPending && !detail.data) {
    return <LoadingState message="관리자 문제 상세를 불러오는 중입니다…" />
  }
  if (!detail.data) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <ErrorState
          autoFocus
          description={errorText(detail.error)}
          headingLevel={1}
          onRetry={() => void detail.refetch()}
          title="문제 상세를 불러오지 못했습니다"
        />
      </section>
    )
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="현재 위치">
        <Link
          className="font-semibold text-brand underline"
          to="/admin/questions"
        >
          문제 관리
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">문제 상세</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{detail.data.question.lifecycleStatus}</Badge>
          <span className="font-mono text-xs text-muted">{questionId}</span>
        </div>
        <h1 className="mt-3 text-3xl font-black">문제 버전 워크플로</h1>
        <p className="mt-3 text-muted">
          행 버전 충돌 시 로컬 편집 내용은 유지되며, 새로고침 후 차이를 확인할
          수 있습니다.
        </p>
      </header>

      {detail.isError ? (
        <div
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="alert"
        >
          <p className="font-semibold">
            최신 문제 정보를 확인하지 못했습니다. 화면의 편집 내용은 그대로
            유지됩니다.
          </p>
          <p className="mt-1 text-sm">{errorText(detail.error)}</p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void detail.refetch()}
          >
            문제 정보 다시 확인
          </Button>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="rounded-2xl border border-line bg-white p-4">
          <h2 className="text-lg font-bold">버전 기록</h2>
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
                  disabled={
                    isEditorDirty &&
                    version.questionVersionId !== effectiveSelectedVersionId
                  }
                  onClick={() =>
                    setSelectedVersionId(version.questionVersionId)
                  }
                >
                  <span className="block font-bold">
                    v{version.versionNumber} · {version.versionStatus}
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
              disabled={versionHistory.isFetchingNextPage}
              fullWidth
              variant="outline"
              onClick={() => void versionHistory.fetchNextPage()}
            >
              {versionHistory.isFetchingNextPage
                ? '이전 버전 불러오는 중…'
                : '이전 버전 더 보기'}
            </Button>
          ) : null}
          {detail.data.question.openCandidateVersionId === null &&
          selectedVersion &&
          preview.data ? (
            <Button
              className="mt-4"
              disabled={isEditorDirty}
              fullWidth
              variant="outline"
              onClick={() => setPendingCommand('CREATE_VERSION')}
            >
              새 초안 버전 만들기
            </Button>
          ) : null}
          {detail.data.question.lifecycleStatus === 'ACTIVE' &&
          selectedVersion ? (
            <Button
              className="mt-2"
              disabled={isEditorDirty}
              fullWidth
              variant="danger"
              onClick={() => setPendingCommand('ARCHIVE')}
            >
              문제 보관
            </Button>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-6">
          {selectedVersion ? (
            <div className="rounded-2xl border border-line bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">
                    v{selectedVersion.versionNumber} ·{' '}
                    {selectedVersion.versionStatus}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    rowVersion {selectedVersion.rowVersion}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {visibleCommands.map((command) => (
                    <Button
                      key={command}
                      disabled={isEditorDirty}
                      variant={
                        sensitiveCommands.has(command) ? 'dark' : 'outline'
                      }
                      onClick={() => setPendingCommand(command)}
                    >
                      {commandLabel[command]}
                    </Button>
                  ))}
                </div>
              </div>
              {isEditorDirty ? (
                <p className="mt-3 text-sm font-semibold text-amber-800">
                  저장하지 않은 편집 내용이 있어 버전 전환과 워크플로 명령을
                  잠갔습니다. 먼저 초안을 저장해 주세요.
                </p>
              ) : null}
              {baseVersion ? (
                <div
                  className="mt-4 rounded-xl bg-slate-50 p-4"
                  aria-live="polite"
                >
                  <strong>이전 버전과 차이</strong>
                  <p className="mt-1 text-sm text-muted">
                    {diff.isPending
                      ? '차이를 계산하는 중입니다…'
                      : diff.isError
                        ? '차이를 불러오지 못했습니다.'
                        : diff.data?.changedFields.length
                          ? diff.data.changedFields.join(', ')
                          : '변경된 필드가 없습니다.'}
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
                      차이 다시 불러오기
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {preview.isPending && !preview.data ? (
            <LoadingState message="버전 미리보기를 불러오는 중입니다…" />
          ) : !preview.data || !selectedVersion ? (
            <ErrorState
              description={errorText(preview.error)}
              onRetry={() => void preview.refetch()}
              title="미리보기를 불러오지 못했습니다"
            />
          ) : (
            <>
              {preview.isError ? (
                <div
                  className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
                  role="alert"
                >
                  <p className="font-semibold">
                    최신 미리보기를 확인하지 못했습니다. 화면의 편집 내용은
                    그대로 유지됩니다.
                  </p>
                  <p className="mt-1 text-sm">{errorText(preview.error)}</p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => void preview.refetch()}
                  >
                    미리보기 다시 확인
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
                    requiresConflictResolution={Boolean(
                      updateVersion.error &&
                        isPhase7UiApiError(updateVersion.error) &&
                        updateVersion.error.code === 'VERSION_CONFLICT'
                    )}
                    rowVersionRevision={rowVersionRevision}
                    serverFieldErrors={
                      updateVersion.error &&
                      isPhase7UiApiError(updateVersion.error)
                        ? updateVersion.error.fieldErrors
                        : undefined
                    }
                    serverMessage={
                      updateVersion.error
                        ? errorText(updateVersion.error)
                        : undefined
                    }
                    submitLabel="초안 변경사항 저장"
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
                conflictRefreshError ??
                '다른 탭이나 관리자가 먼저 수정했습니다. 로컬 편집 내용은 유지됩니다.'
              }
              title="최신 버전 확인이 필요합니다"
              action={
                <Button onClick={() => void refreshAfterConflict()}>
                  최신 rowVersion과 차이 불러오기
                </Button>
              }
            />
          ) : null}

          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-xl font-bold">검수 기록</h2>
            {reviews.isError && reviews.data ? (
              <div
                className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
                role="alert"
              >
                <p className="font-semibold">
                  최신 검수 기록을 확인하지 못했습니다. 현재 기록은 그대로
                  유지됩니다.
                </p>
                <p className="mt-1 text-sm">{errorText(reviews.error)}</p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => void reviews.refetch()}
                >
                  검수 기록 다시 확인
                </Button>
              </div>
            ) : null}
            {reviews.isPending && !reviews.data ? (
              <LoadingState message="검수 기록을 불러오는 중입니다…" />
            ) : !reviews.data ? (
              <ErrorState
                description={errorText(reviews.error)}
                onRetry={() => void reviews.refetch()}
                title="검수 기록을 불러오지 못했습니다"
              />
            ) : reviewItems.length ? (
              <ol className="mt-4 grid gap-3">
                {reviewItems.map((review) => (
                  <li
                    className="rounded-xl border border-line p-4"
                    key={review.id}
                  >
                    <strong>{review.action}</strong>
                    <span className="ml-2 text-sm text-muted">
                      {review.occurredAt}
                    </span>
                    {review.comment ? (
                      <p className="mt-2 whitespace-pre-wrap">
                        {review.comment}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-muted">아직 검수 기록이 없습니다.</p>
            )}
            {reviews.hasNextPage ? (
              <Button
                className="mt-4"
                disabled={reviews.isFetchingNextPage}
                variant="outline"
                onClick={() => void reviews.fetchNextPage()}
              >
                {reviews.isFetchingNextPage
                  ? '이전 검수 기록 불러오는 중…'
                  : '이전 검수 기록 더 보기'}
              </Button>
            ) : null}
          </section>
        </div>
      </div>

      {commandMutation.error ? (
        <ErrorState
          className="mt-6"
          description={errorText(commandMutation.error)}
          title="명령을 완료하지 못했습니다"
          action={
            isPhase7UiApiError(commandMutation.error) &&
            commandMutation.error.code === 'VERSION_CONFLICT' ? (
              <Button onClick={() => void refreshAfterConflict()}>
                최신 버전과 차이 불러오기
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announcement || freshAssurance.completionMessage}
      </p>

      <Dialog
        open={pendingCommand !== null}
        preventClose={commandMutation.isPending}
        title={
          pendingCommand ? `${commandLabel[pendingCommand]} 확인` : '작업 확인'
        }
        description="현재 rowVersion을 기준으로 실행하며 충돌 시 자동 재시도하지 않습니다."
        onOpenChange={(open) => {
          if (!open && !commandMutation.isPending) setPendingCommand(null)
        }}
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingCommand(null)}>
              취소
            </Button>
            <Button
              ref={commandConfirmRef}
              disabled={!canConfirm || !commandInput}
              isLoading={commandMutation.isPending}
              variant={pendingCommand === 'ARCHIVE' ? 'danger' : 'primary'}
              onClick={() => {
                if (commandInput) commandMutation.mutate(commandInput)
              }}
            >
              명시적으로 실행
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
            error={commandNoteError}
            label={requiresNote ? '사유 (필수)' : '검수 메모 (선택)'}
            maxLength={commandNoteScalarLimit * 2}
            name="command-note"
            required={requiresNote}
            rows={4}
            value={commandNote}
            onChange={(event) => setCommandNote(event.currentTarget.value)}
          />
        ) : (
          <p className="leading-7">
            이 작업은 학습자 노출과 기록에 영향을 줄 수 있습니다. 결과를 확인한
            뒤 실행해 주세요.
          </p>
        )}
      </Dialog>
      <FreshAssuranceDialog controller={freshAssurance} />
    </section>
  )
}
