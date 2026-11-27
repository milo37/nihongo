import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { useRushRound } from '@app/practice/hooks/useRushRound'

/** The words missed this round, from the result's [틀린 단어 보기]. */
export const RushWrongList = ({
  log,
  onAgain,
  onBack
}: {
  log: ReturnType<typeof useRushRound>['log']
  onAgain: () => void
  onBack: () => void
}): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <section className="rush rush-result is-list">
      <p className="rush-level">
        {t('rush.wrongTitle', { n: log.filter((row) => !row.ok).length })}
      </p>
      <ul className="rush-wrong-list" lang="ja">
        {log
          .filter((row) => !row.ok)
          .map((row, index) => (
            <li key={index}>
              <b>{row.pair.word}</b>
              <p>
                {row.pair.answer}
                <s>{row.picked}</s>
              </p>
            </li>
          ))}
      </ul>
      <button type="button" className="rush-main" onClick={onAgain}>
        {t('rush.again')}
      </button>
      <button type="button" className="rush-link" onClick={onBack}>
        {t('rush.backToResult')}
      </button>
    </section>
  )
}
