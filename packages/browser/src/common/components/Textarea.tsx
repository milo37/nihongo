import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComponentPropsWithRef, ReactElement } from 'react'
import { classNames } from './classNames'
import { FieldError } from './FieldError'

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
    <div className="ui-field">
      <div className={classNames('ui-field-label', hideLabel && 'sr-only')}>
        <label htmlFor={textareaId}>{label}</label>
        {required ? (
          <span className="ui-field-required">{t('required')}</span>
        ) : null}
      </div>
      <textarea
        className={classNames(
          'ui-textarea',
          error ? 'ui-textarea-invalid' : 'ui-textarea-default',
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
        <p className="ui-field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  )
}
