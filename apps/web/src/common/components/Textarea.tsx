import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComponentPropsWithRef, ReactElement } from 'react'
import { classNames } from '@common/components/classNames'

type TextareaProps = Omit<ComponentPropsWithRef<'textarea'>, 'name'> & {
  name: string
  label: string
  hint?: string
  error?: string
  hideLabel?: boolean
}

export const Textarea = ({
  'aria-describedby': ariaDescribedBy,
  autoComplete,
  className,
  error,
  hideLabel = false,
  hint,
  id,
  label,
  name,
  required = false,
  rows = 5,
  ...props
}: TextareaProps): ReactElement => {
  const { t } = useTranslation('common')
  const generatedId = useId()
  const textareaId = id ?? `${name}-${generatedId}`
  const hintId = hint ? `${textareaId}-hint` : undefined
  const errorId = error ? `${textareaId}-error` : undefined
  const describedBy = [ariaDescribedBy, hintId, errorId]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="grid gap-2">
      <div
        className={classNames(
          'text-sm font-semibold text-ink',
          hideLabel && 'sr-only'
        )}
      >
        <label htmlFor={textareaId}>{label}</label>
        {required ? (
          <span className="ml-1 text-danger">{t('required')}</span>
        ) : null}
      </div>
      <textarea
        className={classNames(
          'min-h-28 w-full resize-y rounded-control border bg-surface px-3 py-2 text-base text-ink shadow-control',
          'placeholder:text-muted/70 hover:border-line-strong',
          'focus-visible:border-brand focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
          'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted',
          error ? 'border-line-invalid' : 'border-line',
          className
        )}
        id={textareaId}
        name={name}
        required={required}
        rows={rows}
        autoComplete={autoComplete ?? 'off'}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...props}
      />
      {hint ? (
        <p className="text-sm text-muted" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          className="text-sm font-medium text-danger"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
