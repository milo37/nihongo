import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel, QuestionSubject } from '@common/types/domain'
import { Button } from '@common/components/Button'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'

const levelOptions: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
export const HomePage = (): ReactElement => {
  const { t } = useTranslation('home')
  const navigate = useNavigate()
  const { role } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [level, setLevel] = useState<JlptLevel>('N3')
  const [subject, setSubject] = useState<QuestionSubject>('GRAMMAR')
  const createSession = useCreateStudySession()
  const isCreatingSession = createSession.isPending || createSession.isPaused
  const subjectOptions: Array<{
    value: QuestionSubject
    label: string
    description: string
  }> = [
    {
      value: 'VOCABULARY',
      label: t('subjects.vocabulary.label'),
      description: t('subjects.vocabulary.description')
    },
    {
      value: 'GRAMMAR',
      label: t('subjects.grammar.label'),
      description: t('subjects.grammar.description')
    },
    {
      value: 'READING',
      label: t('subjects.reading.label'),
      description: t('subjects.reading.description')
    }
  ]
  const featureItems = [
    {
      number: '01',
      title: t('loop.items.wrongNote.title'),
      description: t('loop.items.wrongNote.description')
    },
    {
      number: '02',
      title: t('loop.items.weakness.title'),
      description: t('loop.items.weakness.description')
    },
    {
      number: '03',
      title: t('loop.items.mastery.title'),
      description: t('loop.items.mastery.description')
    }
  ]

  const handleQuickStart = (): void => {
    if (isCreatingSession) {
      return
    }

    createSession.mutate(
      {
        level,
        subject,
        count: 10,
        mode: 'RANDOM'
      },
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
    <>
      <section className="border-b border-line bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-20">
          <div>
            <p className="mb-5 text-sm font-black tracking-[0.18em] text-brand">
              {t('eyebrow')}
            </p>
            <h1 className="max-w-3xl text-4xl font-black leading-[1.12] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              {t('hero.titleLine1')}
              <br />
              {t('hero.titleLine2')}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              {t('hero.description')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-slate-950 px-6 font-bold text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                to="/practice"
              >
                {t('hero.openSetup')}
              </Link>
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-white px-6 font-bold text-slate-800 hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                to={role === 'GUEST' ? '/login' : '/dashboard'}
              >
                {role === 'GUEST'
                  ? t('hero.accountLogin')
                  : t('hero.myDashboard')}
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-slate-50 p-5 shadow-soft sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-brand">
                  {t('quickDrill.eyebrow')}
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {t('quickDrill.title')}
                </h2>
              </div>
              <span className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-muted">
                {t('quickDrill.defaultMode')}
              </span>
            </div>

            <fieldset disabled={isCreatingSession}>
              <legend className="mb-3 text-sm font-bold">
                {t('quickDrill.levelLegend')}
              </legend>
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

            <fieldset className="mt-6" disabled={isCreatingSession}>
              <legend className="mb-3 text-sm font-bold">
                {t('quickDrill.subjectLegend')}
              </legend>
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
              isLoading={isCreatingSession}
              size="lg"
              onClick={handleQuickStart}
            >
              {t('quickDrill.start')}
            </Button>
            {createSession.isError &&
            !isAuthTransitionSupersededError(createSession.error) ? (
              <p
                className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
                role="alert"
              >
                {t('quickDrill.error')}
              </p>
            ) : null}
            <p className="mt-3 text-center text-xs leading-5 text-muted">
              {t('quickDrill.countNote')}
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
            {t('loop.eyebrow')}
          </p>
          <h2 id="loop-title" className="mt-2 text-3xl font-black">
            {t('loop.title')}
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
