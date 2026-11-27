import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { readDailyAnswer, saveDailyAnswer } from '@app/home/dailyAnswer'
import {
  dailyWriteIn,
  WRITE_IN_CHAR_MS,
  writeInStepMs
} from '@app/home/dailyWriteIn'
import type { GetDailyQuestionResponse } from '@api/question/getDailyQuestion/schema'
import { DailyOption } from '@app/home/components/DailyOption'
import {
  QuestionSheet,
  sheetCharacters
} from '@app/home/components/DailyQuestionSheet'

export const DailyQuestionBody = ({
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
