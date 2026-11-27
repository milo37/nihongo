import { useId } from 'react'
import type {
  ComponentPropsWithRef,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode
} from 'react'
import { classNames } from './classNames'
import { FieldError } from './FieldError'

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
    <div className="ui-field">
      <label
        className={classNames('ui-field-label', hideLabel && 'sr-only')}
        htmlFor={selectId}
      >
        {label}
      </label>
      <div className="ui-select-control">
        <select
          className={classNames(
            'ui-select',
            error ? 'ui-select-invalid' : 'ui-select-default',
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
        <svg
          className="ui-select-chevron"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {hint ? (
        <p className="ui-field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  )
}
