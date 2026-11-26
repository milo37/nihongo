import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/contracts/common/enum'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import {
  FALLBACK_LEVEL,
  getInitialLevel
} from '@app/practice/practiceSetupOptions'
import { useRushBest, useRushPairs } from '@app/practice/hooks/useRush'
import { useRushRound } from '@app/practice/hooks/useRushRound'
import { Ring } from '@app/practice/rush/RushMarks'
import { RushPlay } from '@app/practice/rush/RushPlay'
import { RushResult } from '@app/practice/rush/RushResult'

/**
 * #1043 30-second kanji rush (members only): pick the reading of each word
 * from four. Nothing here counts toward the daily goal, the stamps, the
 * accuracy figures or the wrong-answer notes; the server keeps one best
 * score per level.
 */
export const RushPage = (): ReactElement | null => {
  const { isReady, role, user } = useAuth()
  const [params] = useSearchParams()
  if (!isReady) return null
  // Guests never see the way in; a direct address goes back to learn.
  if (role === 'GUEST' || !user) return <Navigate to="/practice" replace />
  const level = getInitialLevel(
    params.get('level'),
    user.targetLevel ?? FALLBACK_LEVEL
  )
  return <Rush key={level} level={level} userId={user.id} />
}

const Rush = ({ level, userId }: { level: JlptLevel; userId: string }) => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const navigate = useNavigate()
  const learnHref = `/practice?level=${level}`
  const pairs = useRushPairs(level)
  const best = useRushBest(userId, level)
  const {
    phase,
    setPhase,
    shown,
    log,
    score,
    streak,
    feedback,
    seconds,
    notice,
    previousBest,
    result,
    saveFailed,
    retrySave,
    start,
    pick
  } = useRushRound({ level, userId, pairs: pairs.data?.pairs, best })

  if (phase === 'play' && shown) {
    return (
      <RushPlay
        shown={shown}
        log={log}
        score={score}
        streak={streak}
        feedback={feedback}
        seconds={seconds}
        notice={notice}
        pick={pick}
        onQuit={() => void navigate(learnHref)}
      />
    )
  }

  if (phase === 'done') {
    return (
      <RushResult
        level={level}
        log={log}
        best={result?.best.best ?? null}
        isNewBest={result?.isNewBest ?? false}
        previousBest={previousBest}
        saveFailed={saveFailed}
        onRetrySave={retrySave}
        learnHref={learnHref}
        onAgain={start}
        onWrong={() => setPhase('wrong')}
      />
    )
  }

  if (phase === 'wrong') {
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
        <button type="button" className="rush-main" onClick={start}>
          {t('rush.again')}
        </button>
        <button
          type="button"
          className="rush-link"
          onClick={() => setPhase('done')}
        >
          {t('rush.backToResult')}
        </button>
      </section>
    )
  }

  return (
    <section className="rush rush-ready">
      <div className="rush-ring-big">
        <Ring seconds={30} running={false} />
      </div>
      <h1>{t('rush.title', { level })}</h1>
      <p>
        {t('rush.lead')}
        {/* Keyboard hint on PC only. */}
        <span className="rush-keys">{t('rush.keys')}</span>
      </p>
      {best !== null ? (
        <p className="rush-best">{t('rush.best', { b: best })}</p>
      ) : null}
      {pairs.isError ? (
        <ErrorState
          density="inline"
          title={commonT('state.requestFailed')}
          description={t('rush.loadError')}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void pairs.refetch()}
            >
              {commonT('actions.retry')}
            </Button>
          }
        />
      ) : null}
      <button
        type="button"
        className="rush-main"
        disabled={!pairs.data?.pairs.length}
        onClick={start}
      >
        {t('rush.start')}
      </button>
      <Link className="rush-link" to={learnHref}>
        {t('rush.toLearn')}
      </Link>
    </section>
  )
}
