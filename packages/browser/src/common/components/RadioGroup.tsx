import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { classNames } from './classNames'
import { FieldError } from './FieldError'

export interface RadioOption {
  value: string
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

type RadioGroupProps = {
  name: string
  legend: string
  options: readonly RadioOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  hint?: string
  error?: string
  disabled?: boolean
  required?: boolean
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

export const RadioGroup = ({
  className,
  defaultValue,
  disabled = false,
  error,
  hint,
  legend,
  name,
  onValueChange,
  options,
  orientation = 'vertical',
  required = false,
  value
}: RadioGroupProps): ReactElement => {
  const { t } = useTranslation('common')
  const generatedId = useId()
  const hintId = hint ? `${name}-${generatedId}-hint` : undefined
  const errorId = error ? `${name}-${generatedId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ')

  return (
    <fieldset
      className={classNames('ui-radio-group', className)}
      disabled={disabled}
      aria-describedby={describedBy || undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="ui-field-label">
        {legend}
        {required ? (
          <span className="ui-field-required">{t('required')}</span>
        ) : null}
      </legend>
      <div
        className={classNames(
          'ui-radio-options',
          orientation === 'horizontal' && 'ui-radio-options-row'
        )}
      >
        {options.map((option, index) => {
          const optionId = `${name}-${generatedId}-${index + 1}`
          const selectionProps =
            value === undefined
              ? { defaultChecked: defaultValue === option.value }
              : { checked: value === option.value }

          return (
            <label
              className={classNames(
                'ui-radio-option',
                error ? 'ui-radio-option-invalid' : 'ui-radio-option-default'
              )}
              key={option.value}
              htmlFor={optionId}
            >
              <input
                className="ui-radio-input"
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                {...selectionProps}
                disabled={option.disabled}
                required={required}
                onChange={(event) => onValueChange?.(event.currentTarget.value)}
              />
              <span className="ui-radio-text">
                <span className="ui-radio-title">{option.label}</span>
                {option.description ? (
                  <span className="ui-radio-description">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          )
        })}
      </div>
      {hint ? (
        <p className="ui-field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </fieldset>
  )
}
