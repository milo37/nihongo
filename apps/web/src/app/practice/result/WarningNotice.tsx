import type { ReactElement, ReactNode } from 'react'

/** Amber status line; `live` announces changes politely. */
export const WarningNotice = ({
  spaced = false,
  live = false,
  children
}: {
  spaced?: boolean
  live?: boolean
  children: ReactNode
}): ReactElement => (
  <p
    className={`${spaced ? 'study-result-warning-spaced ' : ''}study-result-warning`}
    role="status"
    aria-live={live ? 'polite' : undefined}
  >
    {children}
  </p>
)
