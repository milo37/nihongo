import { GradeSquare } from '@common/components/manuscript/GradeSquare'
import {
  ManuscriptSheet,
  SheetTail
} from '@common/components/manuscript/ManuscriptSheet'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { useGetDailyQuestion } from '@app/home/hooks/useGetDailyQuestion'
import { readDailyAnswer, saveDailyAnswer } from '@app/home/dailyAnswer'
import {
  dailyWriteIn,
  WRITE_IN_CHAR_MS,
  writeInStepMs
} from '@app/home/dailyWriteIn'
import { isNoEligibleQuestionsApiError } from '@libs/apiError'
import type { GetDailyQuestionResponse } from '@api/question/getDailyQuestion/schema'

const CARD_CLASS = 'home-daily'

/** Up to three rows of manuscript squares; longer questions stay plain text. */
const SHEET_MAX_ROWS = 3

// A run of ＿ is one blank; it is shortened before spaces go, so blanks
// written side by side stay apart.
const sheetCharacters = (text: string): string[] =>
  Array.from(text.replace(/＿+/gu, '＿').replace(/\s+/gu, ''))

/**
 * One character per square (B4 §3); spaces between words are dropped and
 * each blank takes one square.
 * #997: while `writing`, the squares fill in order like a pen passing.
 */
const QuestionSheet = ({
  text,
  writing
}: {
  text: string
  writing: boolean
}): ReactElement => {
  const characters = sheetCharacters(text)
  const sheetStyle = writing
    ? ({ '--step': `${writeInStepMs(characters.length)}ms` } as CSSProperties)
    : undefined
  const sheet = (columns: number, className: string): ReactElement | null => {
    const rows = Math.max(2, Math.ceil(characters.length / columns))
    if (rows > SHEET_MAX_ROWS) return null
    return (
      <ManuscriptSheet
        className={writing ? `${className} home-daily-write` : className}
        style={sheetStyle}
        columns={columns}
        rows={rows}
        renderCell={(cell) =>
          characters[cell.index] ? (
            <text
              className="home-daily-char"
              style={
                writing ? ({ '--i': cell.index } as CSSProperties) : undefined
              }
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
  // The sheets are hidden from screen readers; this sentence is read once.
  // #1036: with only the wide sheet, it shows only where that sheet does not.
  const sentenceClass =
    wide && narrow
      ? 'sr-only'
      : wide
        ? 'home-daily-question home-daily-question-narrow'
        : 'home-daily-question'
  return (
    <>
      {wide}
      {narrow}
      <p className={sentenceClass} lang="ja">
        {text}
      </p>
    </>
  )
}

/**
 * '오늘의 한 문제': label row, body, result line. Later the body becomes a
 * word or grammar card in the same frame (direction §1-2).
 */
/** One choice; after a pick its label shows ✓/✕ and a small line names it. */
const DailyOption = ({
  answered,
  mark,
  onPick,
  option,
  pressed
}: {
  answered: boolean
  mark: 'correct' | 'wrong' | null
  onPick: () => void
  option: GetDailyQuestionResponse['question']['options'][number]
  pressed: boolean
}): ReactElement => {
  // Left uncompiled: the compiled parent already caches this section, and
  // compiling it too adds about 200 bytes gzip (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('home')
  return (
    <button
      type="button"
      className="home-daily-option"
      data-state={mark ?? undefined}
      aria-pressed={pressed}
      aria-disabled={answered}
      onClick={onPick}
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
          {mark ? <span className="sr-only">{option.label}. </span> : null}
          {option.text}
        </span>
        {mark ? (
          <span className="home-daily-option-mark">
            {t(
              mark === 'correct' ? 'today.dailyAnswer' : 'today.dailyYourAnswer'
            )}
          </span>
        ) : null}
      </span>
    </button>
  )
}

const DailyQuestionBody = ({
  data,
  head
}: {
  data: GetDailyQuestionResponse
  head: ReactNode
}): ReactElement => {
  const { t, i18n } = useTranslation('home')
  const { t: tCommon } = useTranslation('common')
  const { question, date } = data
  const explanationJa = question.explanationJa?.trim()
  const showJa = i18n.resolvedLanguage === 'ja' && Boolean(explanationJa)
  const [picked, setPicked] = useState(() => readDailyAnswer(date, question.id))
  // #997: once per page load, and not on a day already answered (the answer
  // and explanation are showing, so rewriting the question reads oddly).
  const [writing, setWriting] = useState(
    () => !dailyWriteIn.hasPlayed() && picked === null
  )
  useEffect(() => {
    if (!writing) return
    dailyWriteIn.markPlayed()
    const count = sheetCharacters(question.questionText).length
    // Any press or key while it writes shows it whole at once.
    const finish = (): void => setWriting(false)
    const timer = window.setTimeout(
      finish,
      WRITE_IN_CHAR_MS + writeInStepMs(count) * Math.max(0, count - 1)
    )
    window.addEventListener('pointerdown', finish, true)
    window.addEventListener('keydown', finish, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', finish, true)
      window.removeEventListener('keydown', finish, true)
    }
  }, [writing, question.questionText])
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
      <div className="home-daily-top">
        {head}
        <QuestionSheet text={question.questionText} writing={writing} />
      </div>
      <div className="home-daily-rest">
        <div
          role="group"
          aria-label={t('today.dailyOptionsLabel')}
          className="home-daily-options"
        >
          {question.options.map((option) => {
            const isCorrect = picked !== null && option.id === correct?.id
            const isWrongPick =
              picked === option.id && option.id !== correct?.id
            // After a pick the label circle shows ✓/✕ and a small line names
            // it, so short options stay on one line (G, #801 design).
            const mark = isCorrect ? 'correct' : isWrongPick ? 'wrong' : null
            return (
              <DailyOption
                key={option.id}
                answered={picked !== null}
                mark={mark}
                option={option}
                pressed={picked === option.id}
                onPick={() => pick(option.id)}
              />
            )
          })}
        </div>
        <div aria-live="polite">
          {picked ? (
            <div className="home-daily-answer">
              <p className="home-daily-verdict">
                {picked === correct?.id
                  ? t('today.dailyCorrect')
                  : t('today.dailyIncorrect', { label: correct?.label })}
              </p>
              <p className="home-daily-explanation" lang={showJa ? 'ja' : 'ko'}>
                <span className="sr-only">{t('today.dailyExplanation')}: </span>
                {showJa ? explanationJa : question.explanationKo}
              </p>
              {explanationJa || i18n.resolvedLanguage !== 'ja' ? null : (
                <p className="home-daily-note">
                  {tCommon('explanation.japaneseUnavailable')}
                </p>
              )}
            </div>
          ) : null}
        </div>
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
  const head = (
    <div className="home-daily-head">
      <SheetTail side="left" />
      <h2 id="home-daily-title" className="home-daily-title">
        {t('today.dailyLabel')}
      </h2>
      {daily.data ? (
        // #1075: the level only; the subject is already in the sentence.
        <span className="home-daily-meta">{daily.data.level}</span>
      ) : null}
      <SheetTail side="right" />
    </div>
  )
  // #1041: on PC the head and sheet share the first row with the start
  // title; the options start the second row with the lines on the left.
  return (
    <section className={CARD_CLASS} aria-labelledby="home-daily-title">
      {daily.data ? (
        <DailyQuestionBody
          key={daily.data.question.id}
          data={daily.data}
          head={head}
        />
      ) : (
        <div className="home-daily-top">
          {head}
          {daily.isError ? (
            <div className="home-daily-error" role="alert">
              <p className="home-daily-error-text">{t('today.dailyError')}</p>
              <Button
                className="home-daily-retry"
                variant="ghost"
                onClick={() => void daily.refetch()}
              >
                {t('today.dailyRetry')}
              </Button>
            </div>
          ) : (
            // A card skeleton holds the height, so the card does not jump when
            // the question arrives (G, #801 design).
            <div className="home-daily-loading" role="status">
              <span className="sr-only">{t('today.dailyLoading')}</span>
              <div
                aria-hidden="true"
                className="ui-skeleton home-daily-skeleton"
              />
              <div aria-hidden="true" className="home-daily-options">
                {[0, 1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className="ui-skeleton home-daily-skeleton-option"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
