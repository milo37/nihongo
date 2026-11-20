import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import type { CSSProperties, ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/contracts/common/enum'
import { RUSH_SCORE_MAX } from '@api/study/rush/schema'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { FoxSprite } from '@app/practice/result/maru/FoxSprite'
import {
  FALLBACK_LEVEL,
  getInitialLevel
} from '@app/practice/practiceSetupOptions'
import {
  useRushBest,
  useRushPairs,
  useSubmitRushScore
} from '@app/practice/hooks/useRush'
import type { RushPair } from '@api/study/rush/schema'

const ROUND_MS = 30_000
const FEEDBACK_MS = 350
const RING = 2 * Math.PI * 37
const TILTS = [-5, 3, -2, 4, -4, 2, -3]

type Shown = { pair: RushPair; choices: string[]; answer: number }
type Pick = { pair: RushPair; picked: string; ok: boolean }

const shuffle = <T,>(items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}

/** Every pair once before any repeats; never the same pair twice in a row. */
const dealer = (pairs: RushPair[]) => {
  let deck: RushPair[] = []
  let last: RushPair | undefined
  return (): Shown => {
    if (!deck.length) {
      deck = shuffle([...pairs])
      if (deck.length > 1 && deck[deck.length - 1] === last)
        deck.unshift(deck.pop()!)
    }
    const pair = deck.pop()!
    last = pair
    const choices = shuffle([pair.answer, ...pair.wrong])
    return { pair, choices, answer: choices.indexOf(pair.answer) }
  }
}

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const Fox = ({ id, className }: { id: string; className: string }) => (
  <svg className={className} viewBox="0 0 96 96" aria-hidden="true">
    <use href={`#${id}`} />
  </svg>
)

const Slash = () => (
  <svg className="rush-slash" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M10 31L30 9" />
  </svg>
)

const Circle = () => (
  <svg className="rush-circle" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M21 5.5c-9-.5-15.5 6-15.5 14.5s6.5 14.5 14.5 14.5 14.5-6 14.5-14.5c0-6-3.5-10.5-8.5-12.5" />
  </svg>
)

const Ring = ({ seconds, running }: { seconds: number; running: boolean }) => {
  const { t } = useTranslation('practice')
  return (
    <div
      className="rush-ring"
      role="timer"
      aria-label={t('rush.left', { s: seconds })}
    >
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r="37" />
        <circle
          className={running ? 'rush-arc is-running' : 'rush-arc'}
          cx="42"
          cy="42"
          r="37"
          strokeDasharray={`${RING} ${RING}`}
        />
      </svg>
      <b>{seconds}</b>
    </div>
  )
}

const useCountUp = (to: number): number => {
  const [value, setValue] = useState(() => (reducedMotion() ? to : 0))
  useEffect(() => {
    if (reducedMotion()) return
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 600)
      setValue(Math.round(to * p))
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [to])
  return value
}

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
  const navigate = useNavigate()
  const learnHref = `/practice?level=${level}`
  const pairs = useRushPairs(level)
  const best = useRushBest(userId, level)
  const [phase, setPhase] = useState<'ready' | 'play' | 'done' | 'wrong'>(
    'ready'
  )
  const [shown, setShown] = useState<Shown | null>(null)
  const [log, setLog] = useState<Pick[]>([])
  const [streak, setStreak] = useState(0)
  const [feedback, setFeedback] = useState<{
    index: number
    ok: boolean
  } | null>(null)
  const [seconds, setSeconds] = useState(30)
  const [notice, setNotice] = useState('')
  const [previousBest, setPreviousBest] = useState<number | null>(null)
  const deal = useRef<() => Shown>(() => {
    throw new Error('no pairs')
  })
  const pending = useRef<number>(0)
  const submit = useSubmitRushScore(userId, level)
  const score = log.filter((row) => row.ok).length

  const start = () => {
    if (!pairs.data?.pairs.length) return
    deal.current = dealer(pairs.data.pairs)
    setShown(deal.current())
    setLog([])
    setStreak(0)
    setFeedback(null)
    setSeconds(30)
    setNotice('')
    setPreviousBest(best)
    submit.reset()
    setPhase('play')
  }

  useEffect(() => {
    if (phase !== 'play') return
    const endsAt = Date.now() + ROUND_MS
    const tick = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setSeconds(left)
      if (left === 20 || left === 10) setNotice(t('rush.left', { s: left }))
      if (left === 0) setPhase('done')
    }, 200)
    // Leaving the tab ends the round without a record.
    const leave = () => {
      if (document.hidden) setPhase('ready')
    }
    document.addEventListener('visibilitychange', leave)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(pending.current)
      document.removeEventListener('visibilitychange', leave)
    }
  }, [phase, t])

  const { isIdle: unsent, mutate: send } = submit
  useEffect(() => {
    if (phase === 'done' && unsent) send(Math.min(score, RUSH_SCORE_MAX))
  }, [phase, score, unsent, send])

  const pick = (index: number) => {
    if (phase !== 'play' || feedback || !shown) return
    const ok = index === shown.answer
    setLog((rows) => [
      ...rows,
      { pair: shown.pair, picked: shown.choices[index]!, ok }
    ])
    setStreak((value) => (ok ? value + 1 : 0))
    setFeedback({ index, ok })
    setNotice(ok ? t('rush.ok') : t('rush.ng', { a: shown.pair.answer }))
    pending.current = window.setTimeout(() => {
      setFeedback(null)
      setShown(deal.current())
    }, FEEDBACK_MS)
  }

  useEffect(() => {
    if (phase !== 'play') return
    const onKey = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1
      if (index >= 0 && index < 4 && !event.metaKey && !event.ctrlKey)
        pick(index)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (phase === 'play' && shown) {
    const ten = seconds <= 10
    return (
      <section className={`rush is-play${ten ? ' is-ten' : ''}`}>
        <FoxSprite />
        <div className="rush-quit">
          <button type="button" onClick={() => navigate(learnHref)}>
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
          <span
            className={
              shown.pair.word.length > 2
                ? 'rush-box is-long'
                : shown.pair.word.length === 2
                  ? 'rush-box is-pair'
                  : 'rush-box'
            }
            style={{ '--n': shown.pair.word.length } as CSSProperties}
          >
            {[...shown.pair.word].map((char, index) => (
              <span key={index}>{char}</span>
            ))}
            {feedback?.ok ? (
              <i className="rush-stage" aria-hidden="true">
                <Fox id="fox-lift" className="rush-fox is-lift" />
                <Fox id="fox-thud" className="rush-fox is-thud" />
                <svg className="rush-mark" viewBox="0 0 24 22">
                  <use href="#maru-ring" />
                </svg>
              </i>
            ) : null}
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

  if (phase === 'done') {
    return (
      <RushResult
        level={level}
        log={log}
        best={submit.data?.best.best ?? null}
        isNewBest={submit.data?.isNewBest ?? false}
        previousBest={previousBest}
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
          {t('rush.wrongTitle', {
            level,
            n: log.filter((row) => !row.ok).length
          })}
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
      <p>{t('rush.lead')}</p>
      {best !== null ? (
        <p className="rush-best">{t('rush.best', { b: best })}</p>
      ) : null}
      {pairs.isError ? <p role="alert">{t('rush.loadError')}</p> : null}
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

const RushResult = ({
  level,
  log,
  best,
  isNewBest,
  previousBest,
  learnHref,
  onAgain,
  onWrong
}: {
  level: JlptLevel
  log: Pick[]
  best: number | null
  isNewBest: boolean
  previousBest: number | null
  learnHref: string
  onAgain: () => void
  onWrong: () => void
}) => {
  const { t } = useTranslation('practice')
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
