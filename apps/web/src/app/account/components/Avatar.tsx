import type { ReactElement } from 'react'

const sizeClassNames = {
  sm: 'account-avatar-sm',
  lg: 'account-avatar-lg'
} as const

// First letter of the display name on the brand-soft circle.
export const Avatar = ({
  name,
  size
}: {
  name: string
  size: keyof typeof sizeClassNames
}): ReactElement => (
  <span className={`account-avatar ${sizeClassNames[size]}`} aria-hidden="true">
    {Array.from(name.trim())[0] ?? '?'}
  </span>
)
