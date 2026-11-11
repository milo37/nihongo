import { GradeSquare } from '@common/components/manuscript/GradeSquare'
import {
  ManuscriptSheet,
  SheetTail
} from '@common/components/manuscript/ManuscriptSheet'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
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

const CARD_CLASS = 'home-daily'

/** Up to three rows of manuscript squares; longer questions stay plain text. */
const SHEET_MAX_ROWS = 3

/** One character per square (B4 §3); spaces between words are dropped. */
const QuestionSheet = ({ text }: { text: string }): ReactElement => {
  const characters = Array.from(text.replace(/\s+/gu, ''))
  const sheet = (columns: number, className: string): ReactElement | null => {
    const rows = Math.max(2, Math.ceil(characters.length / columns))
    if (rows > SHEET_MAX_ROWS) return null
    return (
      <ManuscriptSheet
        className={className}
        columns={columns}
        rows={rows}
        renderCell={(cell) =>
          characters[cell.index] ? (
            <text
              className="home-daily-char"
              x={cell.x + cell.c / 2}
              y={cell.y + cell.c / 2}
            >
              {characters[cell.index]}
            </text>
          ) : null
        }
      />
    )
  }
  const wide = sheet(15, 'home-daily-sheet home-daily-sheet-wide')
  const narrow = sheet(12, 'home-daily-sheet home-daily-sheet-narrow')
  return (
    <>
      {wide}
      {narrow}
      <p
        className={wide && narrow ? 'sr-only' : 'home-daily-question'}
        lang="ja"
      >
        {text}
      </p>
    </>
  )
}

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
  const { t: tCommon } = useTranslation('common')
  const { question, date } = data
  const explanationJa = question.explanationJa?.trim()
  const showJa = i18n.resolvedLanguage === 'ja' && Boolean(explanationJa)
  const [picked, setPicked] = useState(() => readDailyAnswer(date, question.id))
  const correct = question.options.find(
    (option) => option.id === question.correctOptionId
  )
  const pick = (optionId: string): void => {
    if (picked) return
    setPicked(optionId)
    saveDailyAnswer({ date, questionId: question.id, optionId })
  }
  return (
    <>
      <QuestionSheet text={question.questionText} />
      <div
        role="group"
        aria-label={t('today.dailyOptionsLabel')}
        className="mt-5 grid grid-cols-2 gap-2"
      >
        {question.options.map((option) => {
          const isCorrect = picked !== null && option.id === correct?.id
          const isWrongPick = picked === option.id && option.id !== correct?.id
          // After a pick the label circle shows ✓/✕ and a small line names
          // it, so short options stay on one line (G, #801 design).
          const mark = isCorrect ? 'correct' : isWrongPick ? 'wrong' : null
          return (
            <button
              key={option.id}
              type="button"
              className="home-daily-option"
              data-state={mark ?? undefined}
              aria-pressed={picked === option.id}
              aria-disabled={picked !== null}
              onClick={() => pick(option.id)}
            >
              <span
                className="home-daily-option-label"
                aria-hidden={mark ? true : undefined}
              >
                {mark ? (
                  <GradeSquare grade={mark === 'correct' ? 'ok' : 'ng'} />
                ) : (
                  option.label
                )}
              </span>
              <span className="home-daily-option-text">
                <span lang="ja">
                  {mark ? (
                    <span className="sr-only">{option.label}. </span>
                  ) : null}
                  {option.text}
                </span>
                {mark ? (
                  <span className="home-daily-option-mark">
                    {t(
                      mark === 'correct'
                        ? 'today.dailyAnswer'
                        : 'today.dailyYourAnswer'
                    )}
                  </span>
                ) : null}
              </span>
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
            <p
              className="mt-2 break-words text-[15px] leading-7 text-muted"
              lang={showJa ? 'ja' : 'ko'}
            >
              <span className="sr-only">{t('today.dailyExplanation')}: </span>
              {showJa ? explanationJa : question.explanationKo}
            </p>
            {explanationJa || i18n.resolvedLanguage !== 'ja' ? null : (
              <p className="mt-3 text-sm font-semibold text-subtle">
                {tCommon('explanation.japaneseUnavailable')}
              </p>
            )}
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
      <div className="home-daily-head">
        <SheetTail side="left" />
        <h2 id="home-daily-title" className="home-daily-title">
          {t('today.dailyLabel')}
        </h2>
        {daily.data ? (
          <span className="home-daily-meta">
            {t('today.dailyMeta', {
              level: daily.data.level,
              subject: t(subjectKeys[daily.data.question.subject])
            })}
          </span>
        ) : null}
        <SheetTail side="right" />
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
        // A card skeleton holds the height, so the card does not jump when
        // the question arrives (G, #801 design).
        <div className="mt-3" role="status">
          <span className="sr-only">{t('today.dailyLoading')}</span>
          <div
            aria-hidden="true"
            className="ui-skeleton h-[140px] rounded-control bg-surface-muted sm:h-[105px]"
          />
          <div aria-hidden="true" className="mt-5 grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className="ui-skeleton h-[52px] rounded-control bg-surface-muted"
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
