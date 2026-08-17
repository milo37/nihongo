import { useEffect, useRef } from 'react'
import { Link, useNavigate, useNavigationType, useParams } from 'react-router'
import type { ReactElement } from 'react'
import { isNotFoundApiError } from '@util/apiError'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useGetStudyResult } from '@app/practice/hooks/useGetStudyResult'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'
import { isRealApiMode } from '@libs/apiMode'

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

export const PracticeResultPage = (): ReactElement => {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null)
  const shouldRestoreRetryFocusRef = useRef(false)
  const { role } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const resultQuery = useGetStudyResult(sessionId)
  const sessionQuery = useGetStudySession(sessionId)
  const createSession = useCreateStudySession()

  const isResultReady = Boolean(resultQuery.data && sessionQuery.data)

  useEffect(() => {
    if (
      isResultReady &&
      resultQuery.isSuccess &&
      sessionQuery.isSuccess &&
      (navigationType !== 'POP' || shouldRestoreRetryFocusRef.current)
    ) {
      shouldRestoreRetryFocusRef.current = false
      summaryHeadingRef.current?.focus()
    }
  }, [
    isResultReady,
    navigationType,
    resultQuery.isSuccess,
    sessionQuery.isSuccess
  ])

  if (resultQuery.isPending || sessionQuery.isPending) {
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
            className="font-bold text-brand underline hover:no-underline"
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

  const handleRetryIncorrect = (): void => {
    if (incorrectItems.length === 0 || isRealApiMode) {
      return
    }

    createSession.mutate(
      {
        level: session.level,
        subject: session.subject,
        mode: role === 'GUEST' ? 'RANDOM' : 'WRONG_NOTE',
        count: Math.min(20, incorrectItems.length),
        questionIds: incorrectItems.map((item) => item.question.id)
      },
      {
        onSuccess: ({ session: nextSession }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(nextSession.id, nextSession.startedAt)
          void navigate(`/practice/session/${nextSession.id}`)
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
            ? '게스트 결과는 저장되지 않습니다. 로그인하면 다음 학습부터 오답노트를 사용할 수 있습니다.'
            : `틀린 ${incorrectItems.length}문제가 오답노트에 반영되었습니다.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {incorrectItems.length > 0 && !isRealApiMode ? (
            <Button
              variant="outline"
              isLoading={createSession.isPending}
              onClick={handleRetryIncorrect}
            >
              오답만 다시 풀기
            </Button>
          ) : incorrectItems.length > 0 ? (
            <span className="inline-flex min-h-11 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-950">
              오답 재출제는 실제 API에서 아직 지원되지 않습니다
            </span>
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

      <div className="mt-10 space-y-5">
        <h2 className="text-2xl font-black">문제별 결과</h2>
        {result.items.map((item, index) => {
          const optionById = new Map(
            item.question.options.map((option) => [option.id, option])
          )
          const selectedOption = item.selectedOptionId
            ? optionById.get(item.selectedOptionId)
            : undefined
          const correctOption = optionById.get(item.correctOptionId)

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
              </div>

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
    </section>
  )
}
