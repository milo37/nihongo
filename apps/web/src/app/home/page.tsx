import { isMockApiMode } from '@libs/apiMode'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel, QuestionSubject } from '@common/types/domain'
import { LearningIcon } from '@app/home/LearningIcon'
import { Button } from '@common/components/Button'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'

const levelOptions: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const QuickStart = (): ReactElement => {
  const { t } = useTranslation('home')
  const navigate = useNavigate()
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
      label: t('approved.vocabulary'),
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
  const handleQuickStart = (): void => {
    if (isCreatingSession || !selectedSubject) {
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

  const subjectIcon = {
    VOCABULARY: 'languages',
    GRAMMAR: 'text-cursor-input',
    READING: 'book-open'
  } as const
  const selectedSubject = subjectOptions.find(
    (option) => option.value === subject
  )
  const startLabel = selectedSubject
    ? t('quickDrill.start', { level, subject: selectedSubject.label })
    : ''
  return (
    <form
      className="a2-start-form"
      aria-labelledby="quick-start-title"
      onSubmit={(event) => {
        event.preventDefault()
        handleQuickStart()
      }}
    >
      <div className="a2-settings">
        <h2 id="quick-start-title" className="sr-only">
          {t('quickDrill.title')}
        </h2>
        <fieldset disabled={isCreatingSession}>
          <legend className="mb-4 font-semibold">
            {t('quickDrill.subjectLegend')}
          </legend>
          <div className="a2-subjects">
            {subjectOptions.map((option) => (
              <label className="a2-choice" key={option.value}>
                <input
                  type="radio"
                  name="quick-subject"
                  value={option.value}
                  checked={subject === option.value}
                  onChange={() => setSubject(option.value)}
                />
                <LearningIcon
                  className="a2-subject-icon"
                  name={subjectIcon[option.value]}
                />
                <span>{option.label}</span>
                {subject === option.value ? (
                  <LearningIcon className="a2-check" name="check" />
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-9" disabled={isCreatingSession}>
          <legend className="mb-4 font-semibold">
            {t('quickDrill.levelLegend')}
          </legend>
          <div className="a2-levels">
            {levelOptions.map((option) => (
              <label className="a2-choice" key={option}>
                <input
                  type="radio"
                  name="quick-level"
                  value={option}
                  checked={level === option}
                  onChange={() => setLevel(option)}
                />
                <span>{option}</span>
                {level === option ? (
                  <LearningIcon className="a2-check" name="check" />
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="a2-summary">
        <p className="text-sm text-muted">{t('approved.selected')}</p>
        <p className="mt-3 text-2xl font-semibold" aria-live="polite">
          {level} {selectedSubject?.label}
        </p>
        <p className="mt-3 text-muted">{t('approved.maximum')}</p>
        <Button
          className="a2-start-button mt-6 w-full"
          aria-label={isCreatingSession ? t('approved.loading') : startLabel}
          disabled={!selectedSubject}
          isLoading={isCreatingSession}
          loadingLabel={t('approved.loading')}
          showLoadingIndicator={false}
          size="lg"
          type="submit"
        >
          {startLabel}
        </Button>
        {createSession.isError &&
        !isAuthTransitionSupersededError(createSession.error) ? (
          <p
            className="mt-3 border border-danger-line bg-danger-soft p-3 text-sm font-semibold text-danger-strong"
            role="alert"
          >
            {t('quickDrill.error')}
          </p>
        ) : null}
        <p className="mt-3 text-sm leading-6 text-muted">
          {t('quickDrill.countNote')}
        </p>
      </div>
    </form>
  )
}

export const HomePage = (): ReactElement => {
  const { t } = useTranslation('home')
  const { isReady, role } = useAuth()
  if (isReady && role !== 'GUEST')
    return <Navigate to="/dashboard?view=learning" replace />
  return (
    <section className="learning-note a2-home">
      <header className="border-b border-line pb-4">
        <p className="text-xs text-muted">{t('entry.eyebrow')}</p>
        <h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
          {t('approved.title')}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {t('approved.description')}
        </p>
      </header>
      {role === 'GUEST' ? (
        <>
          <QuickStart />
          <section
            className="mt-10 border-t border-line pt-6"
            aria-label={t('entry.records')}
          >
            <h2 className="text-lg font-semibold">{t('entry.records')}</h2>
            {isMockApiMode ? (
              <aside
                className="mt-3 text-sm leading-6 text-muted"
                aria-label={t('entry.guestNoticeTitle')}
              >
                <p>{t('entry.guestNotice')}</p>
                <Link
                  className="note-link"
                  to="/login?redirect=%2Fdashboard%3Fview%3Dlearning"
                >
                  {t('entry.demoLogin')}
                </Link>
              </aside>
            ) : null}
          </section>
        </>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line py-4">
          <Link className="note-link" to="/practice?count=5">
            {t('entry.other')}
          </Link>
          <Link className="note-link" to="/dashboard">
            {t('entry.records')}
          </Link>
        </div>
      )}
    </section>
  )
}
