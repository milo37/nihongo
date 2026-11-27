import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { Button } from './Button'
import { classNames } from './classNames'

type ErrorStateProps = {
  title?: string
  description: string
  onRetry?: () => void
  retryLabel?: string
  action?: ReactNode
  autoFocus?: boolean
  headingLevel?: 1 | 2 | 3
  className?: string
  density?: 'regular' | 'inline'
}

export const ErrorState = ({
  action,
  autoFocus = false,
  className,
  density = 'regular',
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
        'ui-error',
        density === 'inline' ? 'ui-error-inline' : 'ui-error-regular',
        className
      )}
      role="alert"
      aria-labelledby={titleId}
    >
      <Heading
        ref={headingRef}
        className={classNames(
          'ui-error-title',
          density === 'regular' && 'ui-error-title-regular'
        )}
        id={titleId}
        tabIndex={autoFocus ? -1 : undefined}
      >
        {title ?? t('state.requestFailed')}
      </Heading>
      <p className="ui-error-message">{description}</p>
      {onRetry ? (
        <Button className="ui-error-retry" variant="danger" onClick={onRetry}>
          {retryLabel ?? t('actions.retry')}
        </Button>
      ) : null}
      {action ? <div className="ui-error-action">{action}</div> : null}
    </section>
  )
}
