import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CSSProperties, ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
// Inline so it ships in the result chunk (the bundle contract keeps CSS files initial-only).
import revealStyles from '@app/practice/result/gradingReveal.css?inline'

type GradingRevealProps = {
  /** Correctness in question order. */
  outcomes: readonly boolean[]
  onClose: () => void
}

const LEAD_MS = 500
const FLIP_MS = 380

/** Delay between tiles: whole reveal stays under 2.5s for any count (listgacha 시안 ②). */
export const getRevealSchedule = (count: number) => {
  const gap = Math.min(180, 1600 / Math.max(count, 1))
  return {
    gap,
    total: LEAD_MS + Math.max(count - 1, 0) * gap + FLIP_MS
  }
}

/** Tiles per row: n in one row up to the max, else rows split evenly (design rule). */
export const getRevealColumns = (count: number, max: number): number =>
  count <= max ? count : Math.ceil(count / Math.ceil(count / max))

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * After submit: '채점하고 있어요' → number tiles flip to ○/✕ one by one →
 * score → [결과 보기]. A tap or any key opens the rest at once.
 */
export const GradingReveal = ({
  outcomes,
  onClose
}: GradingRevealProps): ReactElement => {
  const { t, i18n } = useTranslation('result')
  const count = outcomes.length
  const correct = outcomes.filter(Boolean).length
  const [instant] = useState(prefersReducedMotion)
  const [opened, setOpened] = useState(instant ? count : 0)
  const [phase, setPhase] = useState<'checking' | 'revealing' | 'done'>(
    instant ? 'done' : 'checking'
  )
  const timers = useRef<number[]>([])
  const root = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const isDone = phase === 'done'

  const finish = (): void => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    setOpened(count)
    setPhase('done')
  }

  useEffect(() => {
    // After the page has moved focus to the result heading.
    const focusFrame = window.requestAnimationFrame(() => root.current?.focus())
    if (instant) return () => window.cancelAnimationFrame(focusFrame)
    const { gap, total } = getRevealSchedule(count)
    const later = (run: () => void, ms: number): void => {
      timers.current.push(window.setTimeout(run, ms))
    }
    later(() => setPhase('revealing'), LEAD_MS)
    outcomes.forEach((_, index) => {
      later(() => setOpened(index + 1), LEAD_MS + index * gap)
    })
    later(() => setPhase('done'), total)
    const pending = timers.current
    return () => {
      window.cancelAnimationFrame(focusFrame)
      pending.forEach(window.clearTimeout)
    }
  }, [count, instant, outcomes])

  useEffect(() => {
    if (isDone) closeButton.current?.focus()
  }, [isDone])

  const formatNumber = (value: number): string =>
    new Intl.NumberFormat(i18n.resolvedLanguage).format(value)

  return (
    <div
      ref={root}
      className="grading-reveal"
      data-done={isDone || undefined}
      data-perfect={(isDone && correct === count) || undefined}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (!isDone && !(event.target as Element).closest('button')) finish()
      }}
      onKeyDown={(event) => {
        if (!isDone) {
          event.preventDefault()
          finish()
        } else if (event.key === 'Escape') onClose()
      }}
    >
      <style>{revealStyles}</style>
      <h2 className="grading-reveal-title">
        {t(phase === 'checking' ? 'grading.checking' : 'grading.done')}
      </h2>
      <p className="grading-reveal-hint">
        {isDone ? '' : t('grading.skipHint')}
      </p>
      {phase === 'checking' ? (
        <span className="grading-reveal-scan" aria-hidden="true">
          <i />
        </span>
      ) : null}
      <ol
        className="grading-reveal-grid"
        style={
          {
            '--cols': getRevealColumns(count, 5),
            '--cols-wide': getRevealColumns(count, 10)
          } as CSSProperties
        }
        aria-hidden={!isDone || undefined}
      >
        {outcomes.map((isCorrect, index) => {
          const ordinal = formatNumber(index + 1)
          return (
            <li
              key={ordinal}
              className="grading-reveal-tile"
              data-open={index < opened || undefined}
            >
              <span className="grading-reveal-face" aria-hidden="true">
                {ordinal}
              </span>
              <span
                className="grading-reveal-face grading-reveal-back"
                data-correct={isCorrect}
                aria-hidden="true"
              >
                {isCorrect ? '○' : '✕'}
                <small>{ordinal}</small>
              </span>
              <span className="sr-only">
                {t('items.ordinal', { formattedOrdinal: ordinal })}{' '}
                {t(isCorrect ? 'items.correct' : 'items.incorrect')}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="grading-reveal-score" aria-live="polite">
        {isDone
          ? t('summary.score', {
              total: formatNumber(count),
              correct: formatNumber(correct)
            })
          : ''}
      </p>
      {isDone ? (
        <Button
          ref={closeButton}
          className="grading-reveal-close"
          size="lg"
          onClick={onClose}
        >
          {t('grading.showResult')}
        </Button>
      ) : null}
    </div>
  )
}
