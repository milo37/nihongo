import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { FoxSprite } from '@app/practice/result/maru/FoxSprite'
import type { useRushRound } from '@app/practice/hooks/useRushRound'
import { Circle, Fox, Ring, Slash } from '@app/practice/rush/RushMarks'

type RushRound = ReturnType<typeof useRushRound>

/** One word at a time with four readings, the clock and the score. */
export const RushPlay = ({
  shown,
  log,
  score,
  streak,
  feedback,
  seconds,
  notice,
  pick,
  onQuit
}: Pick<
  RushRound,
  'log' | 'score' | 'streak' | 'feedback' | 'seconds' | 'notice' | 'pick'
> & {
  shown: NonNullable<RushRound['shown']>
  onQuit: () => void
}): ReactElement => {
  const { t } = useTranslation('practice')
  const ten = seconds <= 10
  return (
    <section className={`rush is-play${ten ? ' is-ten' : ''}`}>
      <FoxSprite />
      <div className="rush-quit">
        <button type="button" onClick={onQuit}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
          {t('rush.quit')}
        </button>
      </div>
      <div className="rush-top">
        <p className="rush-count">
          <b>
            {score}
            {feedback?.ok ? <span>+1</span> : null}
          </b>
          <small>{t('rush.correct')}</small>
        </p>
        <Ring seconds={seconds} running />
        {/* Below two in a row the spot stays empty (no "streak lost"). */}
        <p className="rush-streak">
          {streak >= 2 ? (
            <>
              {t('rush.streak', { n: streak })}
              <i aria-hidden="true">{'○'.repeat(Math.min(streak, 5))}</i>
            </>
          ) : null}
        </p>
      </div>
      <div
        key={log.length}
        className={`rush-word${feedback && !feedback.ok ? ' is-ng' : ''}`}
        lang="ja"
      >
        <span className="rush-box">
          {[...shown.pair.word].map((char, index) => (
            <span key={index}>
              <b>{char}</b>
              {index === 0 && feedback?.ok ? (
                <i className="rush-stage" aria-hidden="true">
                  <Fox id="fox-lift" className="rush-fox is-lift" />
                  <Fox id="fox-thud" className="rush-fox is-thud" />
                  <svg className="rush-mark" viewBox="0 0 24 22">
                    <use href="#maru-ring" />
                  </svg>
                </i>
              ) : null}
            </span>
          ))}
        </span>
      </div>
      {feedback && !feedback.ok ? (
        <i className="rush-flash" aria-hidden="true" />
      ) : null}
      <div className="rush-choices" lang="ja">
        {shown.choices.map((choice, index) => {
          const mark = !feedback
            ? ''
            : index === feedback.index && !feedback.ok
              ? 'is-ng'
              : index === shown.answer
                ? 'is-ok'
                : ''
          return (
            <button
              key={index}
              type="button"
              className={mark}
              onClick={() => pick(index)}
            >
              <kbd>{index + 1}</kbd>
              <span>{choice}</span>
              {mark === 'is-ng' ? <Slash /> : null}
              {mark === 'is-ok' && !feedback?.ok ? <Circle /> : null}
            </button>
          )
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
    </section>
  )
}
