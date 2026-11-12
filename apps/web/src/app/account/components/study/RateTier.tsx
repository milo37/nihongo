import type { ReactElement } from 'react'

export type RateTier = 'high' | 'mid' | 'low'

// JLP-851: judged on the rounded whole number the screen shows, so 79.6%
// reads 80% and is high.
export const getRateTier = (rate: number): RateTier => {
  const shown = Math.round(rate)
  return shown >= 80 ? 'high' : shown >= 60 ? 'mid' : 'low'
}

// Ink, ochre and vermilion: all AA on white, no green (correct is ink).
export const rateTierTextClass: Record<RateTier, string> = {
  high: 'text-ink',
  mid: 'text-warning',
  low: 'text-brand-strong'
}

export const rateTierFillClass: Record<RateTier, string> = {
  high: 'bg-ink',
  mid: 'bg-warning',
  low: 'bg-brand-strong'
}

// Grading marks ◎ ○ △ so the tier never rests on colour alone. Decorative:
// the tier word is read from hidden text next to the number.
export const RateTierMark = ({
  tier,
  className
}: {
  tier: RateTier
  className: string
}): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    {tier === 'low' ? (
      <path d="M12 4.5 20.5 19h-17z" />
    ) : (
      <circle cx="12" cy="12" r="8.5" />
    )}
    {tier === 'high' ? <circle cx="12" cy="12" r="4" /> : null}
  </svg>
)
