import type { ReactElement, ReactNode } from 'react'

/** Small brand-colored label above a page title. */
export const Eyebrow = ({
  children
}: {
  children: ReactNode
}): ReactElement => (
  <p className="text-sm font-bold tracking-[0.14em] text-brand">{children}</p>
)
