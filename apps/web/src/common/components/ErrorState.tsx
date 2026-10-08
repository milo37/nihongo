import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { Button } from '@common/components/Button'
import { classNames } from '@common/components/classNames'

type ErrorStateProps = {
  title?: string
  description: string
  onRetry?: () => void
  retryLabel?: string
  action?: ReactNode
  autoFocus?: boolean
  headingLevel?: 1 | 2 | 3
  className?: string
}

export const ErrorState = ({
  action,
  autoFocus = false,
  className,
  description,
  headingLevel = 2,
  onRetry,
  retryLabel,
  title
}: ErrorStateProps): ReactElement => {
  const { t } = useTranslation('common')
  const Heading = headingLevel === 1 ? 'h1' : headingLevel === 2 ? 'h2' : 'h3'
  const headingRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (autoFocus) {
      headingRef.current?.focus()
    }
  }, [autoFocus])

  return (
    <section
      className={classNames(
        'rounded-card border border-danger/25 bg-danger-soft px-5 py-6 text-danger-strong',
        className
      )}
      role="alert"
      aria-labelledby={titleId}
    >
      <Heading
        ref={headingRef}
        className="rounded-sm text-balance text-lg font-bold"
        id={titleId}
        tabIndex={autoFocus ? -1 : undefined}
      >
        {title ?? t('state.requestFailed')}
      </Heading>
      <p className="mt-2 break-words leading-7 text-danger-strong">
        {description}
      </p>
      {onRetry ? (
        <Button className="mt-5" variant="danger" onClick={onRetry}>
          {retryLabel ?? t('actions.retry')}
        </Button>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  )
}
