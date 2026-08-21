import { useEffect, useRef, useState } from 'react'
import {
  Link,
  useBlocker,
  useNavigate,
  useNavigationType,
  useParams
} from 'react-router'
import type { ReactElement } from 'react'
import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import {
  isAuthenticationBoundaryApiError,
  isNoEligibleQuestionsApiError,
  isNotFoundApiError,
  isStudyResultNotReadyApiError
} from '@util/apiError'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { useCreateResultRetrySession } from '@app/practice/hooks/useCreateResultRetrySession'
import { useGetStudyResult } from '@app/practice/hooks/useGetStudyResult'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { readResultRetryAttempt } from '@app/practice/resultRetryAttemptStorage'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}분 ${remainder}초`
}

const PracticeResultPageContent = (): ReactElement => {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null)
  const shouldRestoreRetryFocusRef = useRef(false)
  const allowRetryNavigationRef = useRef(false)
  const navigatedRetryDestinationRef = useRef<string | null>(null)
  const [bookmarkMessage, setBookmarkMessage] = useState<{
    questionId: string
    text: string
  } | null>(null)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [isRetrySourceRefreshing, setRetrySourceRefreshing] = useState(false)
  const [retryDestination, setRetryDestination] = useState<string | null>(null)
  const [isRetrySourceMissing, setRetrySourceMissing] = useState(false)
  const [verifiedGuestResultSessionId, setVerifiedGuestResultSessionId] =
    useState<string | null>(null)
  const { isReady: isAuthReady, role, user } = useAuth()
  const principalScope = getStudyDraftPrincipalScope(user)
  const requireFreshGuestOwnerProbe = isAuthReady && role === 'GUEST'
  const resultQuery = useGetStudyResult(
    sessionId,
    requireFreshGuestOwnerProbe,
    isAuthReady
  )
  const sessionQuery = useGetStudySession(
    sessionId,
    requireFreshGuestOwnerProbe,
    isAuthReady
  )
  const createRetrySession = useCreateResultRetrySession()
  const retryNavigationBlocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      createRetrySession.isPending &&
      !allowRetryNavigationRef.current &&
      currentLocation.pathname !== nextLocation.pathname
  )
  const createBookmark = useCreateBookmark()
  const deleteBookmark = useDeleteBookmark()
  const bookmarkMutationActivity = useBookmarkMutationActivity()
  const resultQuestionIds =
    sessionQuery.data?.session.practiceContractVersion === 2
      ? (resultQuery.data?.items.map((item) => item.question.id).toSorted() ??
        [])
      : []
  const bookmarksQuery = useListBookmarks(
    {
      page: 1,
      pageSize: 20,
      ...(resultQuestionIds.length > 0
        ? { questionIds: resultQuestionIds }
        : {})
    },
    role !== 'GUEST' && resultQuestionIds.length > 0
  )

  const isResultReady = Boolean(resultQuery.data && sessionQuery.data)
  const hasCurrentGuestOwnerProof =
    isAuthReady &&
    (role !== 'GUEST' || verifiedGuestResultSessionId === sessionId)
  const hasFrozenRetryAttempt =
    sessionId.length > 0 &&
    readResultRetryAttempt(principalScope, sessionId) !== null

  useEffect(() => {
    if (retryNavigationBlocker.state !== 'blocked') {
      return
    }
    if (retryDestination || !createRetrySession.isPending) {
      retryNavigationBlocker.reset()
    }
  }, [createRetrySession.isPending, retryDestination, retryNavigationBlocker])

  useEffect(() => {
    if (
      !retryDestination ||
      retryNavigationBlocker.state === 'blocked' ||
      navigatedRetryDestinationRef.current === retryDestination
    ) {
      return
    }
    navigatedRetryDestinationRef.current = retryDestination
    allowRetryNavigationRef.current = true
    void navigate(retryDestination)
  }, [navigate, retryDestination, retryNavigationBlocker.state])

  useEffect(() => {
    let nextVerifiedSessionId: string | null | undefined
    if (!isAuthReady || role !== 'GUEST') {
      nextVerifiedSessionId = null
    }
    if (
      nextVerifiedSessionId === undefined &&
      resultQuery.isSuccess &&
      resultQuery.isFetchedAfterMount &&
      resultQuery.data.sessionId === sessionId &&
      sessionQuery.isSuccess &&
      sessionQuery.isFetchedAfterMount &&
      sessionQuery.data.session.id === sessionId
    ) {
      nextVerifiedSessionId = sessionId
    }
    if (
      nextVerifiedSessionId === undefined &&
      ((resultQuery.isError &&
        isAuthenticationBoundaryApiError(resultQuery.error)) ||
        (sessionQuery.isError &&
          isAuthenticationBoundaryApiError(sessionQuery.error)))
    ) {
      nextVerifiedSessionId = null
    }
    if (nextVerifiedSessionId === undefined) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (active) {
        setVerifiedGuestResultSessionId((current) =>
          current === nextVerifiedSessionId ? current : nextVerifiedSessionId
        )
      }
    })
    return () => {
      active = false
    }
  }, [
    isAuthReady,
    resultQuery.data,
    resultQuery.error,
    resultQuery.isError,
    resultQuery.isFetchedAfterMount,
    resultQuery.isSuccess,
    role,
    sessionId,
    sessionQuery.data,
    sessionQuery.error,
    sessionQuery.isError,
    sessionQuery.isFetchedAfterMount,
    sessionQuery.isSuccess
  ])

  useEffect(() => {
    if (!hasFrozenRetryAttempt) {
      return
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasFrozenRetryAttempt])

  useEffect(() => {
    if (
      isAuthReady &&
      hasCurrentGuestOwnerProof &&
      !isRetrySourceRefreshing &&
      isResultReady &&
      resultQuery.isSuccess &&
      sessionQuery.isSuccess &&
      (navigationType !== 'POP' || shouldRestoreRetryFocusRef.current)
    ) {
      shouldRestoreRetryFocusRef.current = false
      summaryHeadingRef.current?.focus()
    }
  }, [
    hasCurrentGuestOwnerProof,
    isAuthReady,
    isRetrySourceRefreshing,
    isResultReady,
    navigationType,
    resultQuery.isSuccess,
    sessionQuery.isSuccess
  ])

  if (
    !isAuthReady ||
    resultQuery.isPending ||
    sessionQuery.isPending ||
    (!hasCurrentGuestOwnerProof &&
      !resultQuery.isError &&
      !sessionQuery.isError)
  ) {
    return <LoadingState message="채점 결과를 불러오고 있습니다." />
  }

  const hasRetryableError =
    (resultQuery.isError && !isNotFoundApiError(resultQuery.error)) ||
    (sessionQuery.isError && !isNotFoundApiError(sessionQuery.error)) ||
    (!resultQuery.isError && !resultQuery.data) ||
    (!sessionQuery.isError && !sessionQuery.data)
  const hasNotFoundError =
    (resultQuery.isError && isNotFoundApiError(resultQuery.error)) ||
    (sessionQuery.isError && isNotFoundApiError(sessionQuery.error))

  if (hasRetryableError) {
    return (
      <ErrorState
        autoFocus={navigationType !== 'POP'}
        headingLevel={1}
        title="학습 결과를 불러오지 못했습니다"
        description="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
        onRetry={() => {
          shouldRestoreRetryFocusRef.current = true
          void Promise.all([resultQuery.refetch(), sessionQuery.refetch()])
        }}
      />
    )
  }

  if (hasNotFoundError || !resultQuery.data || !sessionQuery.data) {
    return (
      <ErrorState
        autoFocus={navigationType !== 'POP'}
        headingLevel={1}
        title="학습 결과를 찾을 수 없습니다"
        description="아직 제출하지 않은 세션이거나 만료된 학습 기록입니다."
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            새 문제 풀기
          </Link>
        }
      />
    )
  }

  if (isRetrySourceMissing) {
    return (
      <ErrorState
        autoFocus
        headingLevel={1}
        title="학습 결과를 찾을 수 없습니다"
        description="재출제할 원본 결과가 없거나 현재 계정에서 접근할 수 없습니다."
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            새 문제 풀기
          </Link>
        }
      />
    )
  }

  const result = resultQuery.data
  const session = sessionQuery.data.session
  const incorrectItems = result.items.filter((item) => !item.isCorrect)
  const canRequestCanonicalRetry = incorrectItems.every(
    (item) =>
      item.sessionQuestionId !== null &&
      item.question.questionVersionId !== null
  )
  const hasPendingBookmarkMutation =
    bookmarkMutationActivity.pendingQuestionIds.size > 0

  const handleRetryIncorrect = (): void => {
    if (
      incorrectItems.length === 0 ||
      !canRequestCanonicalRetry ||
      isNoEligibleQuestionsApiError(createRetrySession.error) ||
      isRetrySourceRefreshing ||
      createRetrySession.isPending
    ) {
      return
    }
    setRetryMessage(null)
    setRetrySourceMissing(false)
    createRetrySession.reset()
    createRetrySession.mutate(
      { principalScope, sourceSessionId: sessionId },
      {
        onSuccess: ({ session: nextSession }) => {
          if (nextSession.session.status === 'SUBMITTED') {
            setRetryDestination(`/practice/result/${nextSession.session.id}`)
            return
          }
          if (nextSession.session.status === 'IN_PROGRESS') {
            setRetryDestination(`/practice/session/${nextSession.session.id}`)
            return
          }
          setRetryMessage(
            '이전에 만든 오답 재출제 세션이 종료됐습니다. 다시 누르면 새 세션을 만듭니다.'
          )
        },
        onError: (error) => {
          if (
            isNotFoundApiError(error) &&
            !isNoEligibleQuestionsApiError(error)
          ) {
            setRetrySourceMissing(true)
            return
          }
          if (isStudyResultNotReadyApiError(error)) {
            setRetryMessage(
              '원본 학습 결과의 현재 상태를 다시 확인하고 있습니다.'
            )
            setRetrySourceRefreshing(true)
            void Promise.all([
              resultQuery.refetch(),
              sessionQuery.refetch()
            ]).then(() => {
              setRetryMessage(null)
              shouldRestoreRetryFocusRef.current = true
              setRetrySourceRefreshing(false)
            })
          }
        }
      }
    )
  }

  const toggleBookmark = (
    item: (typeof result.items)[number],
    isBookmarked: boolean
  ): void => {
    const { question } = item
    if (
      role === 'GUEST' ||
      !question.questionVersionId ||
      !question.tagSummaries
    ) {
      setBookmarkMessage({
        questionId: question.id,
        text: '이 결과에서는 즐겨찾기를 변경할 수 없습니다.'
      })
      return
    }
    setBookmarkMessage(null)
    if (isBookmarked) {
      deleteBookmark.mutate(question.id, {
        onSuccess: () =>
          setBookmarkMessage({
            questionId: question.id,
            text: '즐겨찾기에서 해제했습니다.'
          }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setBookmarkMessage({
              questionId: question.id,
              text: '즐겨찾기 해제를 완료하지 못해 복원했습니다.'
            })
          }
        }
      })
      return
    }
    const characters = [...question.questionText]
    const optimisticBookmark: BookmarkSummary = {
      questionId: question.id,
      question: {
        id: question.id,
        questionVersionId: question.questionVersionId,
        level: question.level,
        subject: question.subject,
        questionType: question.questionType,
        difficulty: question.difficulty,
        questionTextPreview:
          characters.length <= 160
            ? question.questionText
            : `${characters.slice(0, 157).join('')}...`,
        tags: question.tagSummaries
      },
      availability: 'AVAILABLE',
      createdAt: new Date().toISOString()
    }
    createBookmark.mutate(
      { questionId: question.id, optimisticBookmark },
      {
        onSuccess: () =>
          setBookmarkMessage({
            questionId: question.id,
            text: '즐겨찾기에 저장했습니다.'
          }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setBookmarkMessage({
              questionId: question.id,
              text: '즐겨찾기를 저장하지 못해 이전 상태로 복원했습니다.'
            })
          }
        }
      }
    )
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="rounded-2xl bg-slate-950 p-6 text-white sm:p-9">
        <div className="flex flex-wrap gap-2">
          <Badge variant="brand">{session.level}</Badge>
          <Badge>{subjectLabels[session.subject]}</Badge>
        </div>
        <h1
          ref={summaryHeadingRef}
          className="mt-6 rounded-sm text-3xl font-black sm:text-4xl"
          tabIndex={-1}
        >
          학습 결과
        </h1>
        <p className="mt-3 text-slate-300">
          정답과 해설을 확인하고 틀린 문제를 다음 복습으로 연결하세요.
        </p>

        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-700 sm:grid-cols-5">
          <div className="bg-slate-900 p-4">
            <dt className="text-xs text-slate-400">전체</dt>
            <dd className="mt-1 text-2xl font-black">{result.totalCount}</dd>
          </div>
          <div className="bg-slate-900 p-4">
            <dt className="text-xs text-slate-400">정답</dt>
            <dd className="mt-1 text-2xl font-black text-emerald-300">
              {result.correctCount}
            </dd>
          </div>
          <div className="bg-slate-900 p-4">
            <dt className="text-xs text-slate-400">오답</dt>
            <dd className="mt-1 text-2xl font-black text-red-300">
              {result.incorrectCount}
            </dd>
          </div>
          <div className="bg-slate-900 p-4">
            <dt className="text-xs text-slate-400">정답률</dt>
            <dd className="mt-1 text-2xl font-black">{result.correctRate}%</dd>
          </div>
          <div className="col-span-2 bg-slate-900 p-4 sm:col-span-1">
            <dt className="text-xs text-slate-400">소요 시간</dt>
            <dd className="mt-1 text-lg font-black">
              {formatDuration(result.durationSec)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-muted">
          {role === 'GUEST'
            ? '현재 게스트 세션에서는 오답을 다시 풀 수 있지만 계정 오답노트에는 저장되지 않습니다.'
            : `틀린 ${incorrectItems.length}문제가 오답노트에 반영되었습니다.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {incorrectItems.length > 0 &&
          canRequestCanonicalRetry &&
          !isNoEligibleQuestionsApiError(createRetrySession.error) ? (
            <Button
              variant="outline"
              isLoading={
                createRetrySession.isPending || isRetrySourceRefreshing
              }
              loadingLabel={
                isRetrySourceRefreshing
                  ? '결과 확인 중…'
                  : createRetrySession.isPaused
                    ? '연결 대기 중…'
                    : '재출제 중…'
              }
              onClick={handleRetryIncorrect}
            >
              오답만 다시 풀기
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() =>
              void navigate(
                role === 'GUEST'
                  ? `/login?redirect=${encodeURIComponent('/practice')}`
                  : '/wrong-notes'
              )
            }
          >
            {role === 'GUEST' ? '로그인 선택' : '오답노트 보기'}
          </Button>
          <Button onClick={() => void navigate('/practice')}>
            새 문제 풀기
          </Button>
        </div>
      </div>

      {isNoEligibleQuestionsApiError(createRetrySession.error) ? (
        <EmptyState
          autoFocus
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50"
          title="현재 다시 풀 수 있는 오답이 없습니다"
          description="문제가 보관 처리됐거나 재출제 가능한 고정 버전이 남아 있지 않습니다."
          action={
            <Button onClick={() => void navigate('/practice')}>
              새 문제 풀기
            </Button>
          }
        />
      ) : incorrectItems.length > 0 && !canRequestCanonicalRetry ? (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
        >
          이 결과 형식에서는 오답 재출제를 지원하지 않습니다. 새 문제 풀기로
          학습을 이어가 주세요.
        </p>
      ) : incorrectItems.length === 0 ? (
        <EmptyState
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50"
          title="다시 풀 오답이 없습니다"
          description="모든 문제를 맞혔습니다. 새 문제로 학습을 이어가세요."
          action={
            <Button onClick={() => void navigate('/practice')}>
              새 문제 풀기
            </Button>
          }
        />
      ) : createRetrySession.isPaused ? (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
          aria-live="polite"
        >
          오프라인입니다. 연결되면 같은 재출제 키로 요청을 이어갑니다.
        </p>
      ) : createRetrySession.isError &&
        !isStudyResultNotReadyApiError(createRetrySession.error) &&
        !isAuthTransitionSupersededError(createRetrySession.error) ? (
        <div
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-bold">오답 재출제 세션을 만들지 못했습니다.</p>
          <p className="mt-1 leading-6">
            네트워크 상태를 확인한 뒤 같은 버튼으로 다시 시도해 주세요.
          </p>
        </div>
      ) : retryMessage ? (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
          aria-live="polite"
        >
          {retryMessage}
        </p>
      ) : null}

      <div className="mt-10 space-y-5">
        <h2 className="text-2xl font-black">문제별 결과</h2>
        {bookmarkMutationActivity.isPaused ? (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
            role="status"
            aria-live="polite"
          >
            오프라인입니다. 연결되면 즐겨찾기 변경을 다시 시도합니다.
          </p>
        ) : null}
        {role !== 'GUEST' && bookmarksQuery.isError ? (
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"
            role="alert"
          >
            <span>즐겨찾기 상태를 확인하지 못했습니다.</span>
            <Button
              variant="outline"
              onClick={() => void bookmarksQuery.refetch()}
            >
              다시 확인
            </Button>
          </div>
        ) : null}
        {result.items.map((item, index) => {
          const optionById = new Map(
            item.question.options.map((option) => [option.id, option])
          )
          const selectedOption = item.selectedOptionId
            ? optionById.get(item.selectedOptionId)
            : undefined
          const correctOption = optionById.get(item.correctOptionId)
          const isBookmarked = Boolean(
            bookmarksQuery.data?.items.some(
              (bookmark) => bookmark.questionId === item.question.id
            )
          )
          return (
            <article
              key={item.question.id}
              className="content-auto rounded-xl border border-line bg-white p-5 sm:p-7"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={item.isCorrect ? 'success' : 'danger'}>
                    {item.isCorrect ? '정답' : '오답'}
                  </Badge>
                  <Badge>{index + 1}번</Badge>
                  {item.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
                {role !== 'GUEST' ? (
                  <button
                    className="min-h-11 rounded-lg border border-line px-3 text-sm font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-amber-500 data-[selected=true]:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    type="button"
                    disabled={
                      hasPendingBookmarkMutation ||
                      bookmarksQuery.isPending ||
                      bookmarksQuery.isError ||
                      item.question.questionVersionId === null
                    }
                    aria-label={`${index + 1}번 문제 ${
                      isBookmarked ? '즐겨찾기 해제' : '즐겨찾기 추가'
                    }`}
                    aria-pressed={isBookmarked}
                    data-selected={isBookmarked}
                    onClick={() => toggleBookmark(item, isBookmarked)}
                  >
                    {isBookmarked ? '즐겨찾기 해제' : '즐겨찾기'}
                  </button>
                ) : null}
              </div>

              {bookmarkMessage?.questionId === item.question.id ? (
                <p
                  className="mt-3 text-sm font-semibold text-amber-800"
                  role="status"
                >
                  {bookmarkMessage.text}
                </p>
              ) : null}

              {item.question.passage ? (
                <div className="mt-5 border-l-4 border-slate-200 bg-slate-50 p-4 leading-7 text-slate-700">
                  {item.question.passage}
                </div>
              ) : null}
              <h3 className="mt-5 text-xl font-black leading-8">
                {item.question.questionText}
              </h3>

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-4">
                  <dt className="text-xs font-bold text-muted">
                    내가 선택한 답
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {selectedOption
                      ? `${selectedOption.label}. ${selectedOption.text}`
                      : '미응답'}
                  </dd>
                </div>
                <div className="rounded-lg bg-emerald-50 p-4">
                  <dt className="text-xs font-bold text-emerald-800">정답</dt>
                  <dd className="mt-1 font-semibold text-emerald-950">
                    {correctOption
                      ? `${correctOption.label}. ${correctOption.text}`
                      : '정답 정보 없음'}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 border-t border-line pt-5">
                <h4 className="font-black">해설</h4>
                <p className="mt-2 leading-7 text-slate-700">
                  {item.explanationKo}
                </p>
                {item.explanationJa ? (
                  <p className="mt-2 text-sm leading-7 text-muted">
                    {item.explanationJa}
                  </p>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>

      <Dialog
        open={retryNavigationBlocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && retryNavigationBlocker.state === 'blocked') {
            retryNavigationBlocker.reset()
          }
        }}
        title="오답 재출제 요청을 처리하고 있습니다"
        description="요청 결과를 확인한 뒤 새 학습 세션으로 자동 이동합니다. 잠시 현재 화면에 머물러 주세요."
        preventClose
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              if (retryNavigationBlocker.state === 'blocked') {
                retryNavigationBlocker.reset()
              }
            }}
          >
            현재 화면에 머물기
          </Button>
        }
      />
    </section>
  )
}

export const PracticeResultPage = (): ReactElement => {
  const { sessionId = '' } = useParams()
  const { role, user } = useAuth()
  const principalKey = `${role}:${user?.id ?? 'guest'}`

  return <PracticeResultPageContent key={`${principalKey}:${sessionId}`} />
}
