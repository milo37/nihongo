import type { ReactElement } from 'react'

const sizeClassNames = {
  sm: 'size-8 text-sm',
  lg: 'size-14 text-xl'
} as const

// First letter of the display name on the brand-soft circle.
export const Avatar = ({
  name,
  size
}: {
  name: string
  size: keyof typeof sizeClassNames
}): ReactElement => (
  <span
    className={`grid shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand-strong ${sizeClassNames[size]}`}
    aria-hidden="true"
  >
    {Array.from(name.trim())[0] ?? '?'}
  </span>
)
