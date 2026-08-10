import { useId } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

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
  const generatedId = useId()
  const hintId = hint ? `${name}-${generatedId}-hint` : undefined
  const errorId = error ? `${name}-${generatedId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ')

  return (
    <fieldset
      className={classNames('grid min-w-0 gap-3', className)}
      disabled={disabled}
      aria-describedby={describedBy || undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="text-sm font-semibold text-ink">
        {legend}
        {required ? <span className="ml-1 text-red-700">(필수)</span> : null}
      </legend>
      <div
        className={classNames(
          'grid gap-2',
          orientation === 'horizontal' &&
            'sm:grid-flow-col sm:auto-cols-fr sm:grid-rows-1'
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
                'group flex min-h-12 min-w-0 cursor-pointer items-start gap-3 rounded-lg border bg-white px-3 py-3',
                'touch-manipulation transition-[background-color,border-color,box-shadow] duration-150',
                'hover:border-slate-400 hover:bg-slate-50',
                'focus-within:border-brand focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand',
                'has-[:checked]:border-brand has-[:checked]:bg-emerald-50',
                'has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-slate-100 has-[:disabled]:opacity-60',
                error ? 'border-red-300' : 'border-line'
              )}
              key={option.value}
              htmlFor={optionId}
            >
              <input
                className="mt-0.5 size-5 shrink-0 accent-emerald-700"
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                {...selectionProps}
                disabled={option.disabled}
                required={required}
                onChange={(event) => onValueChange?.(event.currentTarget.value)}
              />
              <span className="min-w-0 break-words">
                <span className="block font-medium text-ink">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="mt-1 block text-sm leading-6 text-muted">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          )
        })}
      </div>
      {hint ? (
        <p className="text-sm text-muted" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          className="text-sm font-medium text-red-700"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
