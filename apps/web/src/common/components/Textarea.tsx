import { useId } from 'react'
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
  rows = 5,
  ...props
}: TextareaProps): ReactElement => {
  const generatedId = useId()
  const textareaId = id ?? `${name}-${generatedId}`
  const hintId = hint ? `${textareaId}-hint` : undefined
  const errorId = error ? `${textareaId}-error` : undefined
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
        htmlFor={textareaId}
      >
        {label}
      </label>
      <textarea
        className={classNames(
          'min-h-28 w-full resize-y rounded-lg border bg-white px-3 py-2 text-base text-ink shadow-sm',
          'placeholder:text-slate-400 hover:border-slate-400',
          'focus-visible:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-muted',
          error ? 'border-red-500' : 'border-line',
          className
        )}
        id={textareaId}
        name={name}
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
