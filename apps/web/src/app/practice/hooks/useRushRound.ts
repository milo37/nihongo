import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JlptLevel } from '@nihongo/contracts/common/enum'
import { RUSH_SCORE_MAX } from '@api/study/rush/schema'
import { useSubmitRushScore } from '@app/practice/hooks/useRush'
import type { RushPair } from '@api/study/rush/schema'

const ROUND_MS = 30_000
const FEEDBACK_MS = 350

export type RushShown = { pair: RushPair; choices: string[]; answer: number }
export type RushPick = { pair: RushPair; picked: string; ok: boolean }
export type RushPhase = 'ready' | 'play' | 'done' | 'wrong'

const shuffle = <T>(items: T[]): T[] => {
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
  return (): RushShown => {
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

/**
 * #1043 one 30-second round: deals the pairs, runs the clock, takes picks
 * (by tap or the 1-4 keys) and sends the score once the round is done.
 * Leaving the tab ends the round without a record.
 */
export const useRushRound = ({
  level,
  userId,
  pairs,
  best
}: {
  level: JlptLevel
  userId: string
  pairs: RushPair[] | undefined
  best: number | null
}) => {
  const { t } = useTranslation('practice')
  const [phase, setPhase] = useState<RushPhase>('ready')
  const [shown, setShown] = useState<RushShown | null>(null)
  const [log, setLog] = useState<RushPick[]>([])
  const [streak, setStreak] = useState(0)
  const [feedback, setFeedback] = useState<{
    index: number
    ok: boolean
  } | null>(null)
  const [seconds, setSeconds] = useState(30)
  const [notice, setNotice] = useState('')
  const [previousBest, setPreviousBest] = useState<number | null>(null)
  const deal = useRef<() => RushShown>(() => {
    throw new Error('no pairs')
  })
  const pending = useRef<number>(0)
  const submit = useSubmitRushScore(userId, level)
  const score = log.filter((row) => row.ok).length

  const start = () => {
    if (!pairs?.length) return
    deal.current = dealer(pairs)
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

  return {
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
    result: submit.data,
    start,
    pick
  }
}
