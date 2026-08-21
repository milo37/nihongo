import { useEffect, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

type EmptyStateProps = {
  autoFocus?: boolean
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode
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
    <section
      className={classNames(
        'mx-auto flex max-w-xl flex-col items-center px-4 py-12 text-center',
        className
      )}
      aria-label={title}
    >
      {icon ? (
        <span
          className="mb-5 inline-grid size-12 place-items-center rounded-xl bg-slate-100 text-slate-600"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <Heading
        ref={headingRef}
        className="rounded-sm text-balance text-xl font-bold text-ink"
        tabIndex={autoFocus ? -1 : undefined}
      >
        {title}
      </Heading>
      <p className="mt-3 max-w-prose text-pretty leading-7 text-muted">
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </section>
  )
}
