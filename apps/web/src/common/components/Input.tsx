import { useId } from 'react'
import type { ComponentPropsWithRef, ReactElement } from 'react'
import { classNames } from '@common/components/classNames'

type InputProps = Omit<ComponentPropsWithRef<'input'>, 'name'> & {
  name: string
  label: string
  hint?: string
  error?: string
  hideLabel?: boolean
}

export const Input = ({
  'aria-describedby': ariaDescribedBy,
  autoComplete,
  className,
  error,
  hideLabel = false,
  hint,
  id,
  label,
  name,
  spellCheck,
  type = 'text',
  ...props
}: InputProps): ReactElement => {
  const generatedId = useId()
  const inputId = id ?? `${name}-${generatedId}`
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [ariaDescribedBy, hintId, errorId]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="grid gap-2">
      <label
        className={classNames(
          'text-sm font-semibold text-ink',
          hideLabel && 'sr-only'
        )}
        htmlFor={inputId}
      >
        {label}
      </label>
      <input
        className={classNames(
          'min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-base text-ink shadow-sm',
          'placeholder:text-slate-400 hover:border-slate-400',
          'focus-visible:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-muted',
          error ? 'border-red-500' : 'border-line',
          className
        )}
        id={inputId}
        name={name}
        type={type}
        autoComplete={autoComplete ?? 'off'}
        spellCheck={spellCheck ?? (type === 'email' ? false : undefined)}
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
          className="text-sm font-medium text-red-700"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
