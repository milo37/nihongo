import { useId } from 'react'
import type {
  ComponentPropsWithRef,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode
} from 'react'
import { classNames } from '@common/components/classNames'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

type SelectProps = Omit<ComponentPropsWithRef<'select'>, 'name'> & {
  name: string
  label: string
  options?: readonly SelectOption[]
  placeholder?: string
  hint?: string
  error?: string
  hideLabel?: boolean
  children?: ReactNode
}

export const Select = ({
  'aria-describedby': ariaDescribedBy,
  autoComplete,
  children,
  className,
  error,
  hideLabel = false,
  hint,
  id,
  label,
  name,
  onKeyDown,
  options,
  placeholder,
  ...props
}: SelectProps): ReactElement => {
  const generatedId = useId()
  const selectId = id ?? `${name}-${generatedId}`
  const hintId = hint ? `${selectId}-hint` : undefined
  const errorId = error ? `${selectId}-error` : undefined
  const describedBy = [ariaDescribedBy, hintId, errorId]
    .filter(Boolean)
    .join(' ')
  const handleKeyboardNavigation = (
    event: ReactKeyboardEvent<HTMLSelectElement>
  ): void => {
    onKeyDown?.(event)
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !['ArrowDown', 'ArrowUp', 'End', 'Home'].includes(event.key)
    ) {
      return
    }

    const select = event.currentTarget
    const enabledIndices = Array.from(select.options).flatMap(
      (option, index) => (option.disabled ? [] : [index])
    )
    const currentPosition = enabledIndices.indexOf(select.selectedIndex)
    const nextPosition =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabledIndices.length - 1
          : event.key === 'ArrowDown'
            ? Math.min(enabledIndices.length - 1, currentPosition + 1)
            : Math.max(0, currentPosition - 1)
    const nextIndex = enabledIndices[nextPosition]
    if (nextIndex === undefined || nextIndex === select.selectedIndex) {
      return
    }

    event.preventDefault()
    select.selectedIndex = nextIndex
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }

  return (
    <div className="grid gap-2">
      <label
        className={classNames(
          'text-sm font-semibold text-ink',
          hideLabel && 'sr-only'
        )}
        htmlFor={selectId}
      >
        {label}
      </label>
      <select
        className={classNames(
          'min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-base text-ink shadow-sm',
          'hover:border-slate-400',
          'focus-visible:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-muted',
          error ? 'border-red-500' : 'border-line',
          className
        )}
        id={selectId}
        name={name}
        autoComplete={autoComplete ?? 'off'}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...props}
        onKeyDown={handleKeyboardNavigation}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options
          ? options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))
          : children}
      </select>
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
