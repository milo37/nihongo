import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel, QuestionSubject } from '@common/types/domain'
import { Button } from '@common/components/Button'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

const levelOptions: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const subjectOptions: Array<{
  value: QuestionSubject
  label: string
  description: string
}> = [
  {
    value: 'VOCABULARY',
    label: '문자·어휘',
    description: '한자 읽기와 문맥 어휘'
  },
  {
    value: 'GRAMMAR',
    label: '문법',
    description: '형식 선택과 문장 구성'
  },
  {
    value: 'READING',
    label: '독해',
    description: '짧은 글부터 정보 검색까지'
  }
]

const featureItems = [
  {
    number: '01',
    title: '자동 오답노트',
    description:
      '틀린 횟수와 복습 상태를 기록해 다시 볼 문제를 놓치지 않습니다.'
  },
  {
    number: '02',
    title: '약점 분석',
    description:
      '과목별 정답률과 반복 오답을 기반으로 다음 학습 방향을 잡습니다.'
  },
  {
    number: '03',
    title: '2회 연속 정답',
    description:
      '한 번의 우연이 아니라 두 번 연속 맞힐 때 해결한 문제로 전환합니다.'
  }
]

export const HomePage = (): ReactElement => {
  const navigate = useNavigate()
  const { role } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [level, setLevel] = useState<JlptLevel>('N3')
  const [subject, setSubject] = useState<QuestionSubject>('GRAMMAR')
  const createSession = useCreateStudySession()

  const handleQuickStart = (): void => {
    createSession.mutate(
      {
        level,
        subject,
        count: 10,
        mode: 'RANDOM'
      },
      {
        onSuccess: ({ session }) => {
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        }
      }
    )
  }

  return (
    <>
      <section className="border-b border-line bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-20">
          <div>
            <p className="mb-5 text-sm font-black tracking-[0.18em] text-brand">
              JLPT N5–N1 · VOCABULARY / GRAMMAR / READING
            </p>
            <h1 className="max-w-3xl text-4xl font-black leading-[1.12] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              틀린 문제를
              <br />
              끝까지 해결하는 학습
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              급수와 과목을 고르고 바로 문제를 푸세요. 제출한 오답은 자동으로
              정리되고, 두 번 연속 맞힐 때까지 복습 흐름이 이어집니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-slate-950 px-6 font-bold text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                to="/practice"
              >
                학습 설정 열기
              </Link>
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-white px-6 font-bold text-slate-800 hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                to={role === 'GUEST' ? '/login' : '/dashboard'}
              >
                {role === 'GUEST' ? '계정 로그인' : '내 학습 대시보드'}
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-slate-50 p-5 shadow-soft sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-brand">QUICK DRILL</p>
                <h2 className="mt-1 text-2xl font-black">10문제 바로 풀기</h2>
              </div>
              <span className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-muted">
                기본 RANDOM
              </span>
            </div>

            <fieldset>
              <legend className="mb-3 text-sm font-bold">JLPT 급수</legend>
              <div className="grid grid-cols-5 gap-2">
                {levelOptions.map((option) => (
                  <button
                    key={option}
                    className="min-h-11 rounded-lg border border-line bg-white text-sm font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    type="button"
                    data-selected={level === option}
                    aria-pressed={level === option}
                    onClick={() => setLevel(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-6">
              <legend className="mb-3 text-sm font-bold">학습 과목</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {subjectOptions.map((option) => (
                  <button
                    key={option.value}
                    className="min-h-20 rounded-lg border border-line bg-white px-3 py-3 text-left hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    type="button"
                    data-selected={subject === option.value}
                    aria-pressed={subject === option.value}
                    onClick={() => setSubject(option.value)}
                  >
                    <strong className="block text-sm">{option.label}</strong>
                    <span className="mt-1 block text-xs leading-5 text-muted">
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            <Button
              className="mt-6 w-full"
              isLoading={createSession.isPending}
              size="lg"
              onClick={handleQuickStart}
            >
              선택한 범위로 시작
            </Button>
            {createSession.isError ? (
              <p
                className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
                role="alert"
              >
                선택한 범위에 출제 가능한 문제가 없습니다. 다른 급수나 과목을
                선택해 주세요.
              </p>
            ) : null}
            <p className="mt-3 text-center text-xs leading-5 text-muted">
              문제가 10개보다 적으면 준비된 문제 수만큼 출제합니다.
            </p>
          </div>
        </div>
      </section>

      <section
        className="mx-auto max-w-7xl px-4 py-16 sm:px-6"
        aria-labelledby="loop-title"
      >
        <div className="max-w-2xl">
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            LEARNING LOOP
          </p>
          <h2 id="loop-title" className="mt-2 text-3xl font-black">
            문제를 푸는 순간부터 복습까지 연결됩니다
          </h2>
        </div>
        <div className="mt-9 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          {featureItems.map((feature) => (
            <article key={feature.number} className="bg-white p-7">
              <p className="text-sm font-black text-brand">{feature.number}</p>
              <h3 className="mt-5 text-xl font-black">{feature.title}</h3>
              <p className="mt-3 leading-7 text-muted">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}
