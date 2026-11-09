import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { useGetDailyQuestion } from '@app/home/hooks/useGetDailyQuestion'
import { readDailyAnswer, saveDailyAnswer } from '@app/home/dailyAnswer'
import { isNoEligibleQuestionsApiError } from '@libs/apiError'
import type { GetDailyQuestionResponse } from '@api/question/getDailyQuestion/schema'

const subjectKeys = {
  VOCABULARY: 'subjects.vocabulary.label',
  GRAMMAR: 'subjects.grammar.label',
  READING: 'subjects.reading.label'
} as const

const CARD_CLASS = 'home-daily rounded-card border border-line bg-surface p-6'

/**
 * '오늘의 한 문제': label row, body, result line. Later the body becomes a
 * word or grammar card in the same frame (direction §1-2).
 */
const DailyQuestionBody = ({
  data
}: {
  data: GetDailyQuestionResponse
}): ReactElement => {
  const { t, i18n } = useTranslation('home')
  const { question, date } = data
  const [picked, setPicked] = useState(() => readDailyAnswer(date, question.id))
  const correct = question.options.find(
    (option) => option.id === question.correctOptionId
  )
  const explanation =
    i18n.resolvedLanguage === 'ja' && question.explanationJa
      ? question.explanationJa
      : question.explanationKo
  const pick = (optionId: string): void => {
    if (picked) return
    setPicked(optionId)
    saveDailyAnswer({ date, questionId: question.id, optionId })
  }
  return (
    <>
      <p
        className="mt-3 text-[22px] font-semibold leading-[1.6] text-ink"
        lang="ja"
      >
        {question.questionText}
      </p>
      <div
        role="group"
        aria-label={t('today.dailyOptionsLabel')}
        className="mt-5 grid grid-cols-2 gap-2"
      >
        {question.options.map((option) => {
          const isCorrect = picked !== null && option.id === correct?.id
          const isWrongPick = picked === option.id && option.id !== correct?.id
          return (
            <button
              key={option.id}
              type="button"
              className="home-daily-option"
              data-state={
                isCorrect ? 'correct' : isWrongPick ? 'wrong' : undefined
              }
              aria-pressed={picked === option.id}
              aria-disabled={picked !== null}
              onClick={() => pick(option.id)}
            >
              <span className="home-daily-option-label">{option.label}</span>
              <span className="min-w-0 text-left" lang="ja">
                {option.text}
              </span>
              {isCorrect ? (
                <span className="ml-auto flex items-center">
                  <Icon name="check" />
                  <span className="sr-only">{t('today.dailyAnswer')}</span>
                </span>
              ) : isWrongPick ? (
                <span className="ml-auto flex items-center">
                  <Icon name="x" />
                  <span className="sr-only">{t('today.dailyYourAnswer')}</span>
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div aria-live="polite">
        {picked ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="font-bold text-ink">
              {picked === correct?.id
                ? t('today.dailyCorrect')
                : t('today.dailyIncorrect', { label: correct?.label })}
            </p>
            <p className="mt-2 text-[15px] leading-7 text-muted">
              <span className="sr-only">{t('today.dailyExplanation')}: </span>
              {explanation}
            </p>
          </div>
        ) : null}
      </div>
    </>
  )
}

export const DailyQuestionCard = ({
  level
}: {
  level: JlptLevel
}): ReactElement | null => {
  const { t } = useTranslation('home')
  const daily = useGetDailyQuestion(level)
  // No question for this level today: leave the space empty.
  if (daily.isError && isNoEligibleQuestionsApiError(daily.error)) return null
  return (
    <section className={CARD_CLASS} aria-labelledby="home-daily-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-daily-title" className="text-[15px] font-bold text-brand">
          {t('today.dailyLabel')}
        </h2>
        {daily.data ? (
          <span className="text-[13px] font-semibold text-muted">
            {t('today.dailyMeta', {
              level: daily.data.level,
              subject: t(subjectKeys[daily.data.question.subject])
            })}
          </span>
        ) : null}
      </div>
      {daily.data ? (
        <DailyQuestionBody key={daily.data.question.id} data={daily.data} />
      ) : daily.isError ? (
        <div className="mt-4" role="alert">
          <p className="text-[15px] text-muted">{t('today.dailyError')}</p>
          <Button
            className="mt-3"
            variant="ghost"
            onClick={() => void daily.refetch()}
          >
            {t('today.dailyRetry')}
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-[15px] text-muted" role="status">
          {t('today.dailyLoading')}
        </p>
      )}
    </section>
  )
}
