import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { ReactElement, ReactNode, RefObject } from 'react'
import {
  isNotFoundApiError,
  isQuestionNotAvailableApiError
} from '@util/apiError'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { MemoEditor } from '@app/wrong-note/components/MemoEditor'
import { ReviewTimeline } from '@app/wrong-note/components/ReviewTimeline'
import { useCreateTargetedReviewSession } from '@app/wrong-note/hooks/useCreateTargetedReviewSession'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import { useGetWrongNote } from '@app/wrong-note/hooks/useGetWrongNote'
import { useGetWrongNoteMemo } from '@app/wrong-note/hooks/useGetWrongNoteMemo'
import { useListReviewEvents } from '@app/wrong-note/hooks/useListReviewEvents'
import {
  assertCurrentTargetedReviewAction,
  completeTargetedReviewAction
} from '@app/wrong-note/queries/wrongNoteMutations'
import { getSafeWrongNoteReturnTo } from '@app/wrong-note/reviewQueueSearch'
import { readTargetedReviewAttempt } from '@app/wrong-note/targetedReviewAttemptStorage'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

type WrongNoteDetailContentProps = {
  action?: ReactNode
  data: WrongNoteDetailView
  headingRef?: RefObject<HTMLHeadingElement | null>
}

const statusLabels = {
  NEW: '새 오답',
  REVIEWING: '복습 중',
  AGAIN: '다시 학습',
  SOLVED: '해결'
} as const
const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const
const reviewAvailabilityLabels = {
  AVAILABLE: '현재 출제 가능',
  ARCHIVED: '보관된 문제'
} as const
const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return '기록 없음'
  }

  return dateTimeFormatter.format(new Date(value))
}

export const WrongNoteDetailContent = ({
  action,
  data,
  headingRef
}: WrongNoteDetailContentProps): ReactElement => {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Badge variant="brand">{data.question.level}</Badge>
        <Badge>{subjectLabels[data.question.subject]}</Badge>
        <Badge
          variant={data.wrongNote.status === 'SOLVED' ? 'success' : 'warning'}
        >
          {statusLabels[data.wrongNote.status]}
        </Badge>
        <Badge
          variant={
            data.wrongNote.reviewAvailability === 'ARCHIVED'
              ? 'neutral'
              : 'info'
          }
        >
          {reviewAvailabilityLabels[data.wrongNote.reviewAvailability]}
        </Badge>
      </div>
      <h1
        ref={headingRef}
        className="mt-5 rounded-sm text-3xl font-black leading-tight"
        tabIndex={-1}
      >
        마지막 오답 문제 상세
      </h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
          <p className="mb-4 rounded-lg bg-slate-100 p-3 text-sm font-semibold leading-6 text-slate-700">
            아래 문제·보기·해설은 마지막으로 틀렸을 때 고정된 문제 버전입니다.
          </p>
          {data.question.passage ? (
            <div className="mb-6 border-l-4 border-slate-300 bg-slate-50 p-4 leading-8 text-slate-700">
              {data.question.passage}
            </div>
          ) : null}
          <h2 className="text-2xl font-black leading-9">
            {data.question.questionText}
          </h2>
          <ol className="mt-6 space-y-2">
            {data.question.options.map((option) => (
              <li
                key={option.id}
                className={[
                  'flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-3',
                  option.isCorrect
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-line'
                ].join(' ')}
              >
                <span>
                  {option.label}. {option.text}
                </span>
                {option.isCorrect ? (
                  <strong className="text-sm text-emerald-800">정답</strong>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="mt-7 border-t border-line pt-6">
            <h3 className="text-lg font-black">해설</h3>
            <p className="mt-3 leading-8 text-slate-700">
              {data.question.explanationKo}
            </p>
            {data.question.explanationJa ? (
              <p className="mt-3 text-sm leading-7 text-muted">
                {data.question.explanationJa}
              </p>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {data.question.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        </article>

        <aside className="space-y-5">
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-lg font-black">복습 기록</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted">틀린 횟수</dt>
                <dd className="mt-1 text-xl font-black">
                  {data.wrongNote.wrongCount}회
                </dd>
              </div>
              <div>
                <dt className="text-muted">연속 정답</dt>
                <dd className="mt-1 text-xl font-black">
                  {data.wrongNote.correctStreak}회
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">최근 오답</dt>
                <dd className="mt-1 font-semibold">
                  {formatDateTime(data.wrongNote.lastWrongAt)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">다음 복습</dt>
                <dd className="mt-1 font-semibold">
                  {formatDateTime(data.wrongNote.nextReviewAt)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">최근 복습</dt>
                <dd className="mt-1 font-semibold">
                  {formatDateTime(data.wrongNote.lastReviewedAt)}
                </dd>
              </div>
            </dl>
            <div
              className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950"
              role="status"
            >
              {data.wrongNote.reviewAvailability === 'ARCHIVED' ? (
                '보관된 문제: 현재 출제 가능한 문제 버전이 없습니다.'
              ) : (
                <>
                  현재 출제 가능한 문제 버전으로 단일 복습을 시작할 수 있습니다.
                </>
              )}
            </div>
            {action ? <div className="mt-4">{action}</div> : null}
          </div>
        </aside>
      </div>
    </>
  )
}

export const WrongNoteDetailPage = (): ReactElement => {
  const { questionId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const identityKey = getStudyDraftPrincipalScope(user)
  const wrongNoteQuery = useGetWrongNote(questionId)
  const memoQuery = useGetWrongNoteMemo(questionId)
  const historyQuery = useListReviewEvents(questionId)
  const createTargeted = useCreateTargetedReviewSession()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [memoDirtyState, setMemoDirtyState] = useState({
    isDirty: false,
    questionId
  })
  const [targetedNotice, setTargetedNotice] = useState({
    message: '',
    questionId
  })
  const [targetedAttemptState, setTargetedAttemptState] = useState(() => ({
    identityKey,
    isPresent: readTargetedReviewAttempt(identityKey, questionId) !== null,
    questionId
  }))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const currentQuestionIdRef = useRef(questionId)
  const shouldRestoreRetryFocusRef = useRef(false)
  const returnTo = getSafeWrongNoteReturnTo(searchParams.get('returnTo'))
  const hasTargetedRecoveryAttempt =
    targetedAttemptState.identityKey === identityKey &&
    targetedAttemptState.questionId === questionId
      ? targetedAttemptState.isPresent
      : readTargetedReviewAttempt(identityKey, questionId) !== null
  const isMemoDirty =
    memoDirtyState.questionId === questionId && memoDirtyState.isDirty
  const targetedMessage =
    targetedNotice.questionId === questionId ? targetedNotice.message : ''
  const isCurrentTargetedMutation =
    createTargeted.variables?.questionId === questionId
  const isTargetedPending =
    isCurrentTargetedMutation && createTargeted.isPending
  const isTargetedError = isCurrentTargetedMutation && createTargeted.isError
  const isTargetedPaused = isCurrentTargetedMutation && createTargeted.isPaused
  const isDetailPaused = wrongNoteQuery.fetchStatus === 'paused'
  const handleMemoDirtyChange = useCallback(
    (isDirty: boolean) => setMemoDirtyState({ isDirty, questionId }),
    [questionId]
  )
  const syncTargetedAttemptState = useCallback(
    () =>
      setTargetedAttemptState({
        identityKey,
        isPresent: readTargetedReviewAttempt(identityKey, questionId) !== null,
        questionId
      }),
    [identityKey, questionId]
  )

  useLayoutEffect(() => {
    currentQuestionIdRef.current = questionId
  }, [questionId])

  useEffect(() => {
    if (
      wrongNoteQuery.isSuccess &&
      wrongNoteQuery.data &&
      shouldRestoreRetryFocusRef.current
    ) {
      shouldRestoreRetryFocusRef.current = false
      headingRef.current?.focus()
    }
  }, [wrongNoteQuery.data, wrongNoteQuery.isSuccess])

  if (wrongNoteQuery.isPending && isDetailPaused) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <ErrorState
          headingLevel={1}
          title="오프라인에서는 오답 상세를 불러올 수 없습니다"
          description="연결이 복구되면 이 문제를 자동으로 다시 불러옵니다."
        />
      </section>
    )
  }

  if (wrongNoteQuery.isPending) {
    return <LoadingState message="오답 상세를 불러오고 있습니다." />
  }

  if (
    wrongNoteQuery.isError &&
    !wrongNoteQuery.data &&
    isNotFoundApiError(wrongNoteQuery.error)
  ) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <ErrorState
          headingLevel={1}
          title="오답을 찾을 수 없습니다"
          description="삭제되었거나 현재 계정에 저장되지 않은 문제입니다."
          action={
            <Link
              className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
              to="/wrong-notes"
            >
              오답노트로 돌아가기
            </Link>
          }
        />
      </section>
    )
  }

  if (!wrongNoteQuery.data) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <ErrorState
          headingLevel={1}
          title="오답 상세를 불러오지 못했습니다"
          description="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
          onRetry={() => {
            shouldRestoreRetryFocusRef.current = true
            void wrongNoteQuery.refetch()
          }}
        />
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <Link
        className="mb-6 inline-flex min-h-11 items-center px-1 font-bold text-brand underline underline-offset-2 hover:no-underline"
        to={returnTo}
      >
        {returnTo.startsWith('/wrong-notes/history')
          ? '전체 오답 기록으로 돌아가기'
          : returnTo === '/dashboard'
            ? '학습 대시보드로 돌아가기'
            : '복습 센터로 돌아가기'}
      </Link>
      <WrongNoteDetailContent
        data={wrongNoteQuery.data}
        headingRef={headingRef}
        action={
          <>
            {wrongNoteQuery.data.wrongNote.reviewAvailability === 'AVAILABLE' ||
            hasTargetedRecoveryAttempt ? (
              <>
                <Button
                  fullWidth
                  isLoading={isTargetedPending}
                  loadingLabel={
                    isTargetedPaused ? '연결 대기 중…' : '단일 복습 준비 중…'
                  }
                  disabled={isMemoDirty}
                  onClick={() => {
                    setTargetedNotice({ message: '', questionId })
                    setTargetedAttemptState({
                      identityKey,
                      isPresent: true,
                      questionId
                    })
                    createTargeted.reset()
                    createTargeted.mutate(
                      { principalScope: identityKey, questionId },
                      {
                        onSuccess: ({ session }, input) => {
                          assertCurrentTargetedReviewAction(input)
                          if (
                            input.questionId !== currentQuestionIdRef.current
                          ) {
                            return
                          }
                          if (session.session.status === 'IN_PROGRESS') {
                            beginPractice(
                              session.session.id,
                              session.session.startedAt
                            )
                            void navigate(
                              `/practice/session/${session.session.id}`
                            )
                            completeTargetedReviewAction(input)
                            setTargetedAttemptState({
                              identityKey,
                              isPresent: false,
                              questionId
                            })
                          } else if (session.session.status === 'SUBMITTED') {
                            void navigate(
                              `/practice/result/${session.session.id}`
                            )
                            completeTargetedReviewAction(input)
                            setTargetedAttemptState({
                              identityKey,
                              isPresent: false,
                              questionId
                            })
                          } else {
                            setTargetedNotice({
                              message:
                                wrongNoteQuery.data.wrongNote
                                  .reviewAvailability === 'ARCHIVED'
                                  ? '이전에 만든 단일 복습 세션이 종료됐습니다. 보관된 문제에서는 새 단일 복습을 시작할 수 없습니다.'
                                  : '이전에 만든 단일 복습 세션이 종료됐습니다. 다시 누르면 새 세션을 만듭니다.',
                              questionId
                            })
                            completeTargetedReviewAction(input)
                            setTargetedAttemptState({
                              identityKey,
                              isPresent: false,
                              questionId
                            })
                          }
                        },
                        onError: () => {
                          syncTargetedAttemptState()
                        }
                      }
                    )
                  }}
                >
                  {wrongNoteQuery.data.wrongNote.reviewAvailability ===
                  'ARCHIVED'
                    ? '기존 단일 복습 복구'
                    : '이 문제만 다시 풀기'}
                </Button>
                {wrongNoteQuery.data.wrongNote.reviewAvailability ===
                'ARCHIVED' ? (
                  <p className="mt-3 text-sm font-semibold text-muted">
                    문제는 보관됐지만 이전에 생성된 단일 복습 세션은 같은 요청
                    키로 복구할 수 있습니다.
                  </p>
                ) : null}
                {isMemoDirty ? (
                  <p className="mt-3 text-sm font-semibold text-amber-900">
                    메모를 저장하거나 변경을 취소한 뒤 단일 복습을 시작해
                    주세요.
                  </p>
                ) : null}
                {isTargetedPaused ? (
                  <p
                    className="mt-3 text-sm font-semibold text-amber-900"
                    role="status"
                  >
                    오프라인입니다. 연결되면 같은 요청 키로 단일 복습 생성을
                    이어갑니다.
                  </p>
                ) : null}
                {isTargetedError ? (
                  <p
                    className="mt-3 text-sm font-semibold text-red-800"
                    role="alert"
                  >
                    {isQuestionNotAvailableApiError(createTargeted.error)
                      ? '현재 출제 가능한 문제 버전이 없습니다.'
                      : '단일 복습 세션을 만들지 못했습니다. 다시 시도해 주세요.'}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm font-semibold text-muted">
                보관된 문제는 기록과 메모만 확인할 수 있습니다.
              </p>
            )}
            <p
              className="mt-3 min-h-6 text-sm font-semibold text-muted"
              aria-live="polite"
            >
              {targetedMessage}
            </p>
          </>
        }
      />

      {isDetailPaused ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950"
          role="status"
        >
          오프라인입니다. 현재 저장된 상세를 표시하며 연결되면 서버 상태를 다시
          확인합니다.
        </p>
      ) : null}
      {wrongNoteQuery.isError ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-semibold">
            상세의 최신 상태를 확인하지 못했습니다. 표시 중인 내용과 작성 중인
            메모는 유지됩니다.
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => {
              shouldRestoreRetryFocusRef.current = true
              void wrongNoteQuery.refetch()
            }}
          >
            상세 다시 확인
          </Button>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section
          className="rounded-xl border border-line bg-white p-5 sm:p-7"
          aria-labelledby="memo-heading"
        >
          <h2 id="memo-heading" className="text-xl font-black">
            나의 메모
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            메모는 현재 계정의 이 오답에만 저장되며 자동 저장하지 않습니다.
          </p>
          <div className="mt-5">
            <MemoEditor
              key={`${identityKey}:${questionId}`}
              disabled={isTargetedPending}
              memoQuery={memoQuery}
              onDirtyChange={handleMemoDirtyChange}
              questionId={questionId}
            />
          </div>
        </section>

        <section
          className="rounded-xl border border-line bg-slate-50 p-5 sm:p-7"
          aria-labelledby="timeline-heading"
        >
          <h2 id="timeline-heading" className="text-xl font-black">
            복습 타임라인
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            최신 기록부터 표시하며 상태와 횟수 변화는 텍스트로 함께 제공합니다.
          </p>
          <div className="mt-5">
            <ReviewTimeline historyQuery={historyQuery} />
          </div>
        </section>
      </div>
    </section>
  )
}
