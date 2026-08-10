import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import type { ReactElement } from 'react'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Progress } from '@common/components/Progress'
import { RadioGroup } from '@common/components/RadioGroup'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import { useElapsedSeconds } from '@app/practice/hooks/useElapsedSeconds'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { usePracticeKeyboard } from '@app/practice/hooks/usePracticeKeyboard'
import { useSubmitStudySession } from '@app/practice/hooks/useSubmitStudySession'
import { useDemoAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

const modeLabels = {
  RANDOM: '랜덤',
  WRONG_NOTE: '오답',
  WEAKNESS: '약점 추천',
  BOOKMARK: '즐겨찾기'
} as const

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export const PracticeSessionPage = (): ReactElement => {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useDemoAuth()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [isSubmitDialogOpen, setSubmitDialogOpen] = useState(false)
  const [bookmarkMessage, setBookmarkMessage] = useState<string | null>(null)
  const sessionQuery = useGetStudySession(sessionId)
  const submitSession = useSubmitStudySession(sessionId)
  const createBookmark = useCreateBookmark()
  const deleteBookmark = useDeleteBookmark()
  const bookmarksQuery = useListBookmarks(role !== 'GUEST')
  const storedSessionId = useAppStore((state) => state.sessionId)
  const currentQuestionIndex = useAppStore(
    (state) => state.currentQuestionIndex
  )
  const selectedAnswers = useAppStore((state) => state.selectedAnswers)
  const startedAt = useAppStore((state) => state.startedAt)
  const pendingBookmarkIds = useAppStore((state) => state.pendingBookmarkIds)
  const beginPractice = useAppStore((state) => state.beginPractice)
  const setCurrentQuestionIndex = useAppStore(
    (state) => state.setCurrentQuestionIndex
  )
  const selectAnswer = useAppStore((state) => state.selectAnswer)
  const setPendingBookmark = useAppStore((state) => state.setPendingBookmark)
  const resetPractice = useAppStore((state) => state.resetPractice)
  const elapsedSeconds = useElapsedSeconds(startedAt)

  const questions = sessionQuery.data?.questions ?? []
  const safeQuestionIndex =
    questions.length > 0
      ? Math.min(currentQuestionIndex, questions.length - 1)
      : 0
  const currentQuestion = questions[safeQuestionIndex]
  const answeredCount = questions.reduce(
    (count, question) => (selectedAnswers[question.id] ? count + 1 : count),
    0
  )
  const unansweredCount = Math.max(0, questions.length - answeredCount)

  useEffect(() => {
    if (!sessionQuery.data || storedSessionId === sessionId) {
      return
    }

    beginPractice(sessionId, sessionQuery.data.session.startedAt)
  }, [beginPractice, sessionId, sessionQuery.data, storedSessionId])

  useEffect(() => {
    headingRef.current?.focus()
  }, [safeQuestionIndex])

  const movePrevious = (): void => {
    setCurrentQuestionIndex(Math.max(0, safeQuestionIndex - 1))
  }

  const moveNext = (): void => {
    setCurrentQuestionIndex(
      Math.min(Math.max(questions.length - 1, 0), safeQuestionIndex + 1)
    )
  }

  const handleSelectOption = (optionId: string): void => {
    if (currentQuestion) {
      selectAnswer(currentQuestion.id, optionId)
    }
  }

  usePracticeKeyboard({
    enabled:
      !isSubmitDialogOpen && sessionQuery.data?.session.status !== 'SUBMITTED',
    optionIds: currentQuestion?.options.map((option) => option.id) ?? [],
    onSelectOption: handleSelectOption,
    onPrevious: movePrevious,
    onNext: moveNext
  })

  if (sessionQuery.isPending) {
    return <LoadingState message="문제를 준비하고 있습니다." />
  }

  if (sessionQuery.isError || !sessionQuery.data) {
    return (
      <ErrorState
        headingLevel={1}
        title="학습 세션을 불러오지 못했습니다"
        description="세션 주소를 확인하거나 새 학습을 시작해 주세요."
        action={
          <Button onClick={() => void sessionQuery.refetch()}>다시 시도</Button>
        }
      />
    )
  }

  if (sessionQuery.data.session.status === 'SUBMITTED') {
    return <Navigate replace to={`/practice/result/${sessionId}`} />
  }

  if (!currentQuestion) {
    return (
      <ErrorState
        headingLevel={1}
        title="출제할 문제가 없습니다"
        description="다른 급수, 과목 또는 출제 모드를 선택해 주세요."
        action={
          <Link
            className="font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            학습 설정으로 이동
          </Link>
        }
      />
    )
  }

  const { session, requestedCount, actualCount, usedFallback } =
    sessionQuery.data
  const progressValue = Math.round(
    ((safeQuestionIndex + 1) / questions.length) * 100
  )
  const isLastQuestion = safeQuestionIndex === questions.length - 1
  const isBookmarked =
    pendingBookmarkIds[currentQuestion.id] ??
    Boolean(
      bookmarksQuery.data?.items.some(
        ({ question }) => question.id === currentQuestion.id
      )
    )

  const handleBookmark = (): void => {
    if (role === 'GUEST') {
      setBookmarkMessage('즐겨찾기를 저장하려면 데모 학습자로 로그인해 주세요.')
      return
    }

    setBookmarkMessage(null)
    if (isBookmarked) {
      setPendingBookmark(currentQuestion.id, false)
      deleteBookmark.mutate(currentQuestion.id, {
        onError: () => setPendingBookmark(currentQuestion.id, true)
      })
      return
    }

    setPendingBookmark(currentQuestion.id, true)
    createBookmark.mutate(
      { questionId: currentQuestion.id },
      {
        onError: () => setPendingBookmark(currentQuestion.id, false)
      }
    )
  }

  const handleSubmit = (): void => {
    const elapsedPerQuestion = Math.floor(
      elapsedSeconds / Math.max(questions.length, 1)
    )
    submitSession.mutate(
      {
        durationSec: elapsedSeconds,
        answers: questions.flatMap((question) => {
          const selectedOptionId = selectedAnswers[question.id]

          return selectedOptionId
            ? [
                {
                  questionId: question.id,
                  selectedOptionId,
                  elapsedSec: elapsedPerQuestion
                }
              ]
            : []
        })
      },
      {
        onSuccess: () => {
          setSubmitDialogOpen(false)
          resetPractice()
          void navigate(`/practice/result/${sessionId}`)
        }
      }
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="grid gap-5 border-b border-line pb-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge>{session.level}</Badge>
            <Badge variant="neutral">{subjectLabels[session.subject]}</Badge>
            <Badge variant="brand">{modeLabels[session.mode]}</Badge>
          </div>
          <p className="mt-4 text-sm font-semibold text-muted">
            현재 {safeQuestionIndex + 1}번 / 전체 {questions.length}문제 · 답변{' '}
            {answeredCount}문제
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">경과 시간</span>
          <strong className="font-mono text-lg">
            {formatDuration(elapsedSeconds)}
          </strong>
        </div>
      </div>

      {actualCount < requestedCount || usedFallback ? (
        <div
          className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          {actualCount < requestedCount
            ? `요청한 ${requestedCount}문제 중 출제 가능한 ${actualCount}문제를 제공합니다.`
            : '선택한 모드의 문제가 부족해 랜덤 문제를 함께 제공합니다.'}
        </div>
      ) : null}

      <div className="mt-5">
        <Progress
          label={`문제풀이 진행률 ${progressValue}%`}
          value={progressValue}
        />
      </div>

      <div
        className={[
          'mt-6 overflow-hidden rounded-2xl border border-line bg-white shadow-soft',
          currentQuestion.subject === 'READING'
            ? 'lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]'
            : ''
        ].join(' ')}
      >
        {currentQuestion.passage ? (
          <article className="border-b border-line bg-slate-50 p-5 sm:p-8 lg:max-h-[680px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <p className="text-xs font-black tracking-[0.14em] text-brand">
              READING PASSAGE
            </p>
            <p className="sr-only">독해 지문</p>
            <p className="mt-5 whitespace-pre-line text-base leading-8 text-slate-800">
              {currentQuestion.passage}
            </p>
          </article>
        ) : null}

        <article className="p-5 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {currentQuestion.tags.map((tag) => (
                <Badge key={tag} variant="neutral">
                  {tag}
                </Badge>
              ))}
            </div>
            <button
              className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-sm font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-amber-500 data-[selected=true]:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              type="button"
              aria-pressed={isBookmarked}
              data-selected={isBookmarked}
              onClick={handleBookmark}
            >
              {isBookmarked ? '즐겨찾기 해제' : '즐겨찾기'}
            </button>
          </div>
          {bookmarkMessage ? (
            <p
              className="mt-3 text-sm font-semibold text-amber-800"
              role="status"
            >
              {bookmarkMessage}{' '}
              <Link
                className="underline hover:no-underline"
                to="/login?redirect=%2Fpractice"
              >
                로그인 선택
              </Link>
            </p>
          ) : null}

          <h1
            ref={headingRef}
            className="mt-7 rounded-sm text-2xl font-black leading-10 sm:text-3xl"
            tabIndex={-1}
          >
            <span className="sr-only">{safeQuestionIndex + 1}번 문제. </span>
            {currentQuestion.questionText}
          </h1>

          <div className="mt-7">
            <RadioGroup
              name={`question-${currentQuestion.id}`}
              legend="정답 보기"
              value={selectedAnswers[currentQuestion.id] ?? ''}
              options={currentQuestion.options.map((option) => ({
                value: option.id,
                label: `${option.label}. ${option.text}`
              }))}
              onValueChange={handleSelectOption}
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">
            숫자 1–4로 답을 선택하고, ← → 키로 문제를 이동할 수 있습니다.
          </p>
        </article>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          disabled={safeQuestionIndex === 0}
          onClick={movePrevious}
        >
          이전
        </Button>
        {isLastQuestion ? (
          <Button onClick={() => setSubmitDialogOpen(true)}>답안 제출</Button>
        ) : (
          <Button onClick={moveNext}>다음</Button>
        )}
      </div>

      <nav className="mt-8" aria-label="문제 바로가기">
        <ol className="flex flex-wrap justify-center gap-2">
          {questions.map((question, index) => (
            <li key={question.id}>
              <button
                className="min-h-11 min-w-11 rounded-lg border border-line bg-white text-sm font-bold hover:border-slate-400 hover:bg-slate-50 data-[current=true]:border-brand data-[current=true]:bg-brand data-[current=true]:text-white data-[answered=true]:ring-2 data-[answered=true]:ring-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-label={`${index + 1}번 문제${selectedAnswers[question.id] ? ', 답변함' : ', 미응답'}`}
                aria-current={index === safeQuestionIndex ? 'step' : undefined}
                data-current={index === safeQuestionIndex}
                data-answered={Boolean(selectedAnswers[question.id])}
                onClick={() => setCurrentQuestionIndex(index)}
              >
                {index + 1}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <Dialog
        open={isSubmitDialogOpen}
        title="답안을 제출하시겠습니까?"
        description={
          unansweredCount > 0
            ? `아직 답하지 않은 문제가 ${unansweredCount}개 있습니다. 미응답은 오답으로 처리됩니다.`
            : '모든 문제에 답했습니다. 제출 후에는 답을 수정할 수 없습니다.'
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setSubmitDialogOpen(false)}
            >
              계속 풀기
            </Button>
            <Button isLoading={submitSession.isPending} onClick={handleSubmit}>
              제출하고 결과 보기
            </Button>
          </>
        }
        onOpenChange={setSubmitDialogOpen}
      />
    </section>
  )
}
