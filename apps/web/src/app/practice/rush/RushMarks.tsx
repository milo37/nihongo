import { useTranslation } from 'react-i18next'

const RING = 2 * Math.PI * 37

export const Fox = ({ id, className }: { id: string; className: string }) => (
  <svg className={className} viewBox="0 0 96 96" aria-hidden="true">
    <use href={`#${id}`} />
  </svg>
)

export const Slash = () => (
  <svg className="rush-slash" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M10 31L30 9" />
  </svg>
)

export const Circle = () => (
  <svg className="rush-circle" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M21 5.5c-9-.5-15.5 6-15.5 14.5s6.5 14.5 14.5 14.5 14.5-6 14.5-14.5c0-6-3.5-10.5-8.5-12.5" />
  </svg>
)

export const Ring = ({
  seconds,
  running
}: {
  seconds: number
  running: boolean
}) => {
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
