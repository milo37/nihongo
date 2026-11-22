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
    className={`${spaced ? 'mt-4 ' : ''}rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong`}
    role="status"
    aria-live={live ? 'polite' : undefined}
  >
    {children}
  </p>
)
