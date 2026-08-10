import type { ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

type EmptyStateProps = {
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode
  headingLevel?: 2 | 3
  className?: string
}

export const EmptyState = ({
  action,
  className,
  description,
  headingLevel = 2,
  icon,
  title
}: EmptyStateProps): ReactElement => {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'

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
      <Heading className="text-balance text-xl font-bold text-ink">
        {title}
      </Heading>
      <p className="mt-3 max-w-prose text-pretty leading-7 text-muted">
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </section>
  )
}
