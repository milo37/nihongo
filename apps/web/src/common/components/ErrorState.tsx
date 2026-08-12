import { useEffect, useId, useRef } from 'react'
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
  retryLabel = '다시 시도',
  title = '요청을 완료하지 못했습니다'
}: ErrorStateProps): ReactElement => {
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
        'rounded-xl border border-red-200 bg-red-50 px-5 py-6 text-red-950',
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
        {title}
      </Heading>
      <p className="mt-2 break-words leading-7 text-red-900">{description}</p>
      {onRetry ? (
        <Button className="mt-5" variant="danger" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  )
}
