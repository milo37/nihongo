import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@common/types/domain'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useCancelStudySession } from '@app/practice/hooks/useCancelStudySession'
import { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'
import { isNoEligibleQuestionsApiError } from '@util/apiError'

const levels: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const subjects: Array<{ value: QuestionSubject; label: string }> = [
  { value: 'VOCABULARY', label: '문자·어휘' },
  { value: 'GRAMMAR', label: '문법' },
  { value: 'READING', label: '독해' }
]
const counts = [5, 10, 20] as const
const modes: Array<{
  value: StudyMode
  label: string
  description: string
  requiresLogin: boolean
}> = [
  {
    value: 'RANDOM',
    label: '랜덤 문제',
    description: '선택한 급수와 과목에서 무작위로 출제합니다.',
    requiresLogin: false
  },
  {
    value: 'WRONG_NOTE',
    label: '오답 문제',
    description: '아직 해결하지 못한 오답을 우선 출제합니다.',
    requiresLogin: true
  },
  {
    value: 'WEAKNESS',
    label: '약점 추천',
    description: '최근 제출에서 안정적으로 자주 틀린 문제를 우선합니다.',
    requiresLogin: false
  },
  {
    value: 'BOOKMARK',
    label: '즐겨찾기',
    description: '저장한 문제만 모아 다시 풉니다.',
    requiresLogin: true
  },
  {
    value: 'DAILY_REVIEW',
    label: '오늘의 복습',
    description: '서버 일정상 오늘 복습할 오답을 순서대로 풉니다.',
    requiresLogin: true
  }
]

const getInitialLevel = (value: string | null): JlptLevel => {
  return levels.includes(value as JlptLevel) ? (value as JlptLevel) : 'N3'
}

const getInitialSubject = (value: string | null): QuestionSubject => {
  const values = subjects.map((item) => item.value)
  return values.includes(value as QuestionSubject)
    ? (value as QuestionSubject)
    : 'GRAMMAR'
}

const getInitialCount = (value: string | null): 5 | 10 | 20 => {
  const numberValue = Number(value)
  return counts.includes(numberValue as 5 | 10 | 20)
    ? (numberValue as 5 | 10 | 20)
    : 10
}

const getRequestedMode = (value: string | null): StudyMode => {
  const requested = modes.find((item) => item.value === value)
  return requested?.value ?? 'RANDOM'
}

const loginRequiredModes: readonly StudyMode[] = [
  'BOOKMARK',
  'DAILY_REVIEW',
  'WRONG_NOTE'
]

export const PracticePage = (): ReactElement => {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isReady, role, user } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const storedSessionId = useAppStore((state) => state.sessionId)
  const [resumablePage, setResumablePage] = useState(1)
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null)
  const resumableHeadingRef = useRef<HTMLHeadingElement>(null)
  const [level, setLevel] = useState<JlptLevel>(() =>
    getInitialLevel(searchParams.get('level'))
  )
  const [subject, setSubject] = useState<QuestionSubject>(() =>
    getInitialSubject(searchParams.get('subject'))
  )
  const [count, setCount] = useState<5 | 10 | 20>(() =>
    getInitialCount(searchParams.get('count'))
  )
  const [requestedMode, setRequestedMode] = useState<StudyMode>(() =>
    getRequestedMode(searchParams.get('mode'))
  )
  const mode = requestedMode
  const isProtectedGuestMode =
    role === 'GUEST' && loginRequiredModes.includes(mode)
  const createSession = useCreateStudySession()
  const principalScope = getStudyDraftPrincipalScope(user)
  const canLoadResumableSessions =
    isReady && (user !== null || storedSessionId !== null)
  const resumableSessions = useListResumableStudySessions(
    resumablePage,
    5,
    canLoadResumableSessions
  )
  const resumablePageCount = resumableSessions.data
    ? Math.max(
        1,
        Math.ceil(
          resumableSessions.data.total / resumableSessions.data.pageSize
        )
      )
    : resumablePage
  const cancelSession = useCancelStudySession(principalScope)
  const isCreatingSession = createSession.isPending || createSession.isPaused
  const noEligibleQuestions =
    createSession.isError && isNoEligibleQuestionsApiError(createSession.error)

  useEffect(() => {
    if (
      !resumableSessions.data ||
      resumableSessions.data.page !== resumablePage
    ) {
      return
    }
    if (resumablePage > resumablePageCount) {
      const timerId = window.setTimeout(() => {
        setResumablePage(resumablePageCount)
      }, 0)
      return () => window.clearTimeout(timerId)
    }
  }, [resumablePage, resumablePageCount, resumableSessions.data])

  const handleStart = (): void => {
    if (!isReady || isCreatingSession || isProtectedGuestMode) {
      return
    }

    createSession.mutate(
      { level, subject, count, mode },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        }
      }
    )
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:py-16">
      <div className="flex flex-col gap-4 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            PRACTICE SETUP
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">
            오늘 풀 문제를 설정하세요
          </h1>
          <p className="mt-3 text-muted">
            출제 가능한 문제가 부족하면 가능한 수만 제공하고 실제 문항 수를
            알려드립니다.
          </p>
        </div>
        <p className="text-sm font-semibold text-muted">
          현재 역할: <span className="text-ink">{role}</span>
        </p>
      </div>

      <section
        className="mt-8 rounded-2xl border border-line bg-slate-50 p-5 sm:p-6"
        aria-labelledby="resumable-practice-title"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              ref={resumableHeadingRef}
              id="resumable-practice-title"
              className="text-xl font-black focus:outline-none"
              tabIndex={-1}
            >
              이어서 풀기
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              서버에 저장된 진행 중 세션을 최신 작업본부터 보여드립니다.
            </p>
          </div>
          {resumableSessions.isFetching && !resumableSessions.isPending ? (
            <span className="text-sm font-semibold text-muted" role="status">
              목록 갱신 중…
            </span>
          ) : null}
        </div>

        {!canLoadResumableSessions ? (
          <p className="mt-4 rounded-lg border border-line bg-white p-4 text-sm leading-6 text-muted">
            새 게스트 세션을 시작하면 이 탭에서 서버 작업본을 이어서 풀 수
            있습니다. 로그인하면 다른 기기에서도 같은 계정의 작업본을 확인할 수
            있습니다.
          </p>
        ) : resumableSessions.isPending ? (
          <p className="mt-4 text-sm font-semibold text-muted" role="status">
            저장된 작업본을 확인하고 있습니다…
          </p>
        ) : resumableSessions.isError ? (
          <div
            className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            role="alert"
          >
            <p>이어풀기 목록을 불러오지 못했습니다.</p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => void resumableSessions.refetch()}
            >
              다시 시도
            </Button>
          </div>
        ) : resumableSessions.data.items.length === 0 ? (
          <p className="mt-4 rounded-lg border border-line bg-white p-4 text-sm leading-6 text-muted">
            저장된 진행 중 작업본이 없습니다. 아래에서 새 학습을 시작해 주세요.
          </p>
        ) : (
          <>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {resumableSessions.data.items.map((item) => {
                const canResume =
                  item.resumeAvailability === 'SERVER' ||
                  storedSessionId === item.id
                return (
                  <li
                    key={item.id}
                    className="rounded-xl border border-line bg-white p-4"
                  >
                    <p className="font-black">
                      {item.level} ·{' '}
                      {subjects.find(({ value }) => value === item.subject)
                        ?.label ?? item.subject}
                    </p>
                    <p className="mt-1 text-xs font-black tracking-wide text-brand">
                      {modes.find(({ value }) => value === item.mode)?.label ??
                        item.mode}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {item.actualCount}문제 · 현재 {item.currentOrdinal ?? 1}번
                      · revision {item.draftRevision ?? 0}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-muted">
                      {item.draftSavedAt
                        ? `마지막 저장 ${new Date(item.draftSavedAt).toLocaleString('ko-KR')}`
                        : '아직 서버 저장 전'}
                    </p>
                    {item.resumeAvailability === 'LEGACY_LOCAL_ONLY' &&
                    !canResume ? (
                      <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900">
                        이 세션은 다른 기기의 로컬 답안을 복원할 수 없습니다. 새
                        학습을 시작하거나 세션을 취소해 주세요.
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canResume ? (
                        <Link
                          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          to={`/practice/session/${item.id}`}
                        >
                          이어서 풀기
                        </Link>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setCancelSessionId(item.id)}
                      >
                        세션 취소
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {resumableSessions.data.total > resumableSessions.data.pageSize ? (
              <nav
                className="mt-4 flex items-center justify-center gap-3"
                aria-label="이어풀기 페이지"
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={resumablePage === 1}
                  onClick={() => setResumablePage((page) => page - 1)}
                >
                  이전
                </Button>
                <span className="text-sm font-bold">
                  {resumablePage} / {resumablePageCount}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={resumablePage >= resumablePageCount}
                  onClick={() => setResumablePage((page) => page + 1)}
                >
                  다음
                </Button>
              </nav>
            ) : null}
          </>
        )}
      </section>

      <div className="mt-8 space-y-9 rounded-2xl border border-line bg-white p-5 shadow-soft sm:p-8">
        <fieldset disabled={isCreatingSession}>
          <legend className="text-lg font-black">1. 급수</legend>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {levels.map((option) => (
              <button
                key={option}
                className="min-h-12 rounded-lg border border-line font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-pressed={level === option}
                data-selected={level === option}
                onClick={() => {
                  createSession.reset()
                  setLevel(option)
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={isCreatingSession}>
          <legend className="text-lg font-black">2. 과목</legend>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {subjects.map((option) => (
              <button
                key={option.value}
                className="min-h-12 rounded-lg border border-line px-4 font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-pressed={subject === option.value}
                data-selected={subject === option.value}
                onClick={() => {
                  createSession.reset()
                  setSubject(option.value)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={isCreatingSession}>
          <legend className="text-lg font-black">3. 문제 수</legend>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {counts.map((option) => (
              <button
                key={option}
                className="min-h-12 rounded-lg border border-line font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-pressed={count === option}
                data-selected={count === option}
                onClick={() => {
                  createSession.reset()
                  setCount(option)
                }}
              >
                {option}문제
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={isCreatingSession}>
          <legend className="text-lg font-black">4. 출제 모드</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {modes.map((option) => {
              const disabled =
                !isReady || (option.requiresLogin && role === 'GUEST')
              return (
                <button
                  key={option.value}
                  className="min-h-24 rounded-xl border border-line p-4 text-left enabled:hover:border-slate-400 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  type="button"
                  disabled={disabled}
                  aria-pressed={mode === option.value}
                  data-selected={mode === option.value}
                  onClick={() => {
                    createSession.reset()
                    setRequestedMode(option.value)
                  }}
                >
                  <strong className="block">{option.label}</strong>
                  <span className="mt-1 block text-sm leading-6 text-muted">
                    {option.description}
                  </span>
                  {disabled ? (
                    <span className="mt-1 block text-xs font-bold text-amber-700">
                      로그인 후 이용 가능
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </fieldset>

        {isProtectedGuestMode ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
            role="alert"
          >
            선택한 모드는 로그인 후 이용할 수 있습니다. 랜덤 문제로 바꾸지
            않았습니다.{' '}
            <Link
              className="inline-flex min-h-11 items-center px-1 font-bold underline underline-offset-2 hover:no-underline"
              to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
            >
              로그인하기
            </Link>
          </div>
        ) : null}

        {noEligibleQuestions ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
            role="alert"
          >
            <p className="font-bold">
              현재 조건에는 출제 가능한{' '}
              {modes.find((item) => item.value === mode)?.label} 문제가
              없습니다.
            </p>
            <p className="mt-1 leading-6">
              급수·과목·모드를 바꾸거나 랜덤 문제를 선택해 주세요. 서버가 다른
              모드로 자동 대체하지는 않습니다.
            </p>
            {mode !== 'RANDOM' ? (
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() => {
                  createSession.reset()
                  setRequestedMode('RANDOM')
                }}
              >
                랜덤 문제 선택
              </Button>
            ) : null}
          </div>
        ) : createSession.isError &&
          !isAuthTransitionSupersededError(createSession.error) ? (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            role="alert"
          >
            세션을 만들지 못했습니다. 네트워크 상태와 선택 조건을 확인한 뒤 다시
            시도해 주세요.
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            서버 권위 출제 모드는 후보가 부족해도 다른 모드로 자동 대체하지
            않습니다.
            {role === 'GUEST' ? (
              <>
                {' '}
                <Link
                  className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
                  to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
                >
                  로그인하기
                </Link>
              </>
            ) : null}
          </p>
          <Button
            className="shrink-0"
            disabled={!isReady || isProtectedGuestMode}
            isLoading={isCreatingSession}
            size="lg"
            onClick={handleStart}
          >
            학습 시작하기
          </Button>
        </div>
      </div>

      <Dialog
        open={cancelSessionId !== null}
        fallbackFocusRef={resumableHeadingRef}
        title="진행 중 세션을 취소할까요?"
        description="취소하면 서버 작업본은 삭제되며 이 세션에는 더 이상 답안을 저장하거나 제출할 수 없습니다."
        footer={
          <>
            <Button
              variant="secondary"
              disabled={cancelSession.isPending}
              onClick={() => setCancelSessionId(null)}
            >
              계속 보관
            </Button>
            <Button
              isLoading={cancelSession.isPending}
              onClick={() => {
                if (!cancelSessionId) {
                  return
                }
                cancelSession.mutate(
                  { sessionId: cancelSessionId },
                  { onSuccess: () => setCancelSessionId(null) }
                )
              }}
            >
              세션 취소
            </Button>
          </>
        }
        preventClose={cancelSession.isPending}
        onOpenChange={(open) => {
          if (!open && !cancelSession.isPending) {
            setCancelSessionId(null)
          }
        }}
      >
        {cancelSession.isError &&
        !isAuthTransitionSupersededError(cancelSession.error) ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
            role="alert"
          >
            세션을 취소하지 못했습니다. 상태를 새로 확인한 뒤 다시 시도해
            주세요.
          </p>
        ) : null}
      </Dialog>
    </section>
  )
}
