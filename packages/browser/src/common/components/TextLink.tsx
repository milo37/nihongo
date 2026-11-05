import { Link } from 'react-router'
import type { LinkProps } from 'react-router'
import type { ReactElement } from 'react'

/** Bold underlined in-app link, the action of empty and terminal state screens. */
export const TextLink = (props: Omit<LinkProps, 'className'>): ReactElement => (
  <Link
    {...props}
    className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
  />
)
