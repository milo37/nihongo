import { useId } from 'react'
import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

type CheckboxProps = Omit<ComponentPropsWithRef<'input'>, 'name' | 'type'> & {
  name: string
  label: ReactNode
  description?: ReactNode
  error?: string
}

export const Checkbox = ({
  'aria-describedby': ariaDescribedBy,
  className,
  description,
  error,
  id,
  label,
  name,
  ...props
}: CheckboxProps): ReactElement => {
  const generatedId = useId()
  const checkboxId = id ?? `${name}-${generatedId}`
  const descriptionId = description ? `${checkboxId}-description` : undefined
  const errorId = error ? `${checkboxId}-error` : undefined
  const describedBy = [ariaDescribedBy, descriptionId, errorId]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="grid gap-2">
      <label
        className={classNames(
          'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-transparent p-2',
          'touch-manipulation hover:bg-slate-50 focus-within:bg-slate-50',
          'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand',
          'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
          className
        )}
        htmlFor={checkboxId}
      >
        <input
          className="mt-0.5 size-5 shrink-0 accent-emerald-700"
          id={checkboxId}
          type="checkbox"
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          {...props}
        />
        <span className="min-w-0 break-words">
          <span className="block font-medium text-ink">{label}</span>
          {description ? (
            <span
              className="mt-1 block text-sm leading-6 text-muted"
              id={descriptionId}
            >
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p
          className="pl-2 text-sm font-medium text-red-700"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
