import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useToast } from '@nihongo/browser/common/components/Toast'
import type { JlptLevel } from '@nihongo/contracts/common/enum'
import { FoxSprite } from '@app/practice/result/maru/FoxSprite'
import type { RushPick } from '@app/practice/hooks/useRushRound'
import { useCountUp } from '@app/practice/hooks/useCountUp'
import { Fox, Slash } from '@app/practice/rush/RushMarks'

const TILTS = [-5, 3, -2, 4, -4, 2, -3]

export const RushResult = ({
  level,
  log,
  best,
  isNewBest,
  previousBest,
  saveFailed,
  onRetrySave,
  learnHref,
  onAgain,
  onWrong
}: {
  level: JlptLevel
  log: RushPick[]
  best: number | null
  isNewBest: boolean
  previousBest: number | null
  saveFailed: boolean
  onRetrySave: () => void
  learnHref: string
  onAgain: () => void
  onWrong: () => void
}) => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  // #1262: a failed save is a toast that stays, with the retry in it (the
  // result has no save button of its own).
  const { addToast, dismissToast } = useToast()
  const retryRef = useRef(onRetrySave)
  retryRef.current = onRetrySave
  useEffect(() => {
    if (!saveFailed) return
    const id = addToast({
      key: 'rush-save',
      title: t('rush.saveFailed'),
      variant: 'warning',
      persistent: true,
      action: {
        label: commonT('actions.retry'),
        onClick: () => retryRef.current()
      }
    })
    return () => dismissToast(id)
  }, [saveFailed, addToast, dismissToast, t, commonT])
  const score = log.filter((row) => row.ok).length
  const shownScore = useCountUp(score)
  const wrong = log.length - score
  let run = 0
  let maxRun = 0
  for (const row of log) {
    run = row.ok ? run + 1 : 0
    maxRun = Math.max(maxRun, run)
  }
  return (
    <section className="rush rush-result">
      <FoxSprite />
      <p className="rush-level">{t('rush.title', { level })}</p>
      <h1
        className="rush-score"
        aria-label={`${score}${t('rush.scoreUnit', { n: score })}`}
      >
        <b>{shownScore}</b>
        {t('rush.scoreUnit', { n: score })}
      </h1>
      <p className="rush-seq" aria-hidden="true">
        {log.map((row, index) =>
          row.ok ? (
            <i
              key={index}
              className="maru-stamp"
              style={{ rotate: `${TILTS[index % 7]}deg` }}
            />
          ) : (
            <Slash key={index} />
          )
        )}
      </p>
      <p className="rush-meta">
        {t('rush.meta', { t: log.length, n: score, c: maxRun })}
      </p>
      {best === null ? null : (
        <div className="rush-best-line">
          {isNewBest ? (
            <>
              <Fox id="fox-yay" className="rush-yay" />
              <p>
                <b>
                  {previousBest === null
                    ? t('rush.firstRecord')
                    : t('rush.newBest')}
                </b>
                {previousBest === null ? null : (
                  <small>{t('rush.previousBest', { b: previousBest })}</small>
                )}
              </p>
            </>
          ) : (
            <p>
              {t('rush.best', { b: best })}
              {best > score ? (
                <small>{t('rush.toBest', { n: best - score })}</small>
              ) : null}
            </p>
          )}
        </div>
      )}
      <button type="button" className="rush-main" onClick={onAgain}>
        {t('rush.again')}
      </button>
      {wrong > 0 ? (
        <button type="button" className="rush-sub" onClick={onWrong}>
          {t('rush.wrong', { n: wrong })}
        </button>
      ) : null}
      <Link className="rush-link" to={learnHref}>
        {t('rush.toLearn')}
      </Link>
    </section>
  )
}
