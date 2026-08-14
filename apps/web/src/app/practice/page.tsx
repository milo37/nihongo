import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@common/types/domain'
import { Button } from '@common/components/Button'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

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
    description: '최근 정답률이 낮은 문제 유형을 우선합니다.',
    requiresLogin: false
  },
  {
    value: 'BOOKMARK',
    label: '즐겨찾기',
    description: '저장한 문제만 모아 다시 풉니다.',
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

const getInitialMode = (
  value: string | null,
  role: 'GUEST' | 'USER' | 'ADMIN'
): StudyMode => {
  const values = modes.map((item) => item.value)
  const requestedMode = values.includes(value as StudyMode)
    ? (value as StudyMode)
    : 'RANDOM'

  if (
    role === 'GUEST' &&
    (requestedMode === 'WRONG_NOTE' || requestedMode === 'BOOKMARK')
  ) {
    return 'RANDOM'
  }

  return requestedMode
}

export const PracticePage = (): ReactElement => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { role } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [level, setLevel] = useState<JlptLevel>(() =>
    getInitialLevel(searchParams.get('level'))
  )
  const [subject, setSubject] = useState<QuestionSubject>(() =>
    getInitialSubject(searchParams.get('subject'))
  )
  const [count, setCount] = useState<5 | 10 | 20>(() =>
    getInitialCount(searchParams.get('count'))
  )
  const [mode, setMode] = useState<StudyMode>(() =>
    getInitialMode(searchParams.get('mode'), role)
  )
  const createSession = useCreateStudySession()

  const handleStart = (): void => {
    const safeMode =
      role === 'GUEST' && (mode === 'WRONG_NOTE' || mode === 'BOOKMARK')
        ? 'RANDOM'
        : mode

    createSession.mutate(
      { level, subject, count, mode: safeMode },
      {
        onSuccess: ({ session }) => {
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

      <div className="mt-8 space-y-9 rounded-2xl border border-line bg-white p-5 shadow-soft sm:p-8">
        <fieldset>
          <legend className="text-lg font-black">1. 급수</legend>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {levels.map((option) => (
              <button
                key={option}
                className="min-h-12 rounded-lg border border-line font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-pressed={level === option}
                data-selected={level === option}
                onClick={() => setLevel(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-lg font-black">2. 과목</legend>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {subjects.map((option) => (
              <button
                key={option.value}
                className="min-h-12 rounded-lg border border-line px-4 font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-pressed={subject === option.value}
                data-selected={subject === option.value}
                onClick={() => setSubject(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-lg font-black">3. 문제 수</legend>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {counts.map((option) => (
              <button
                key={option}
                className="min-h-12 rounded-lg border border-line font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-pressed={count === option}
                data-selected={count === option}
                onClick={() => setCount(option)}
              >
                {option}문제
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-lg font-black">4. 출제 모드</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {modes.map((option) => {
              const disabled = option.requiresLogin && role === 'GUEST'
              return (
                <button
                  key={option.value}
                  className="min-h-24 rounded-xl border border-line p-4 text-left enabled:hover:border-slate-400 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  type="button"
                  disabled={disabled}
                  aria-pressed={mode === option.value}
                  data-selected={mode === option.value}
                  onClick={() => setMode(option.value)}
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

        {createSession.isError ? (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            role="alert"
          >
            세션을 만들지 못했습니다. 선택 조건을 확인하고 다시 시도해 주세요.
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            오답·즐겨찾기 모드는 저장된 문제가 없으면 랜덤 문제로 대체됩니다.
            {role === 'GUEST' ? (
              <>
                {' '}
                <Link
                  className="font-bold text-brand underline hover:no-underline"
                  to="/login"
                >
                  로그인하기
                </Link>
              </>
            ) : null}
          </p>
          <Button
            className="shrink-0"
            isLoading={createSession.isPending}
            size="lg"
            onClick={handleStart}
          >
            학습 시작하기
          </Button>
        </div>
      </div>
    </section>
  )
}
