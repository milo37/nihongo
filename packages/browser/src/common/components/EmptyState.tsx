import { useEffect, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { classNames } from './classNames'

type EmptyStateProps = {
  autoFocus?: boolean
  title: string
  /** Omit for a one-sentence empty state. */
  description?: string
  action?: ReactNode
  icon?: ReactNode
  /** A picture above the title, shown as is (no icon box). */
  illustration?: ReactNode
  headingLevel?: 2 | 3
  className?: string
}

export const EmptyState = ({
  action,
  autoFocus = false,
  className,
  description,
  headingLevel = 2,
  icon,
  illustration,
  title
}: EmptyStateProps): ReactElement => {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (autoFocus) {
      headingRef.current?.focus()
    }
  }, [autoFocus])

  return (
    <section className={classNames('ui-empty', className)} aria-label={title}>
      {illustration}
      {icon ? (
        <span className="ui-empty-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <Heading
        ref={headingRef}
        className="ui-empty-title"
        tabIndex={autoFocus ? -1 : undefined}
      >
        {title}
      </Heading>
      {description ? (
        <p className="ui-empty-description">{description}</p>
      ) : null}
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </section>
  )
}
