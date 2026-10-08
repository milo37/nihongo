import { useId } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

export interface ChoiceRadioOption<Value extends string> {
  value: Value
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

type ChoiceRadioGroupProps<Value extends string> = {
  name: string
  legend: string
  options: readonly ChoiceRadioOption<Value>[]
  value: Value
  onValueChange: (value: Value) => void
  selectionIndicator?: ReactNode
  appearance?: 'cards' | 'segmented'
  disabled?: boolean
  className?: string
}

export const ChoiceRadioGroup = <Value extends string>({
  name,
  legend,
  options,
  value,
  onValueChange,
  selectionIndicator,
  appearance = 'cards',
  disabled = false,
  className
}: ChoiceRadioGroupProps<Value>): ReactElement => {
  const id = useId()
  return (
    <fieldset
      className={classNames(
        'choice-group',
        appearance === 'segmented' && 'choice-group-segmented',
        className
      )}
      disabled={disabled}
    >
      <legend>{legend}</legend>
      <div className="choice-options">
        {options.map((option, index) => (
          <label
            className="choice-option"
            htmlFor={`${id}-${index}`}
            key={option.value}
          >
            <input
              id={`${id}-${index}`}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
            />
            <span className="choice-surface">
              <span className="choice-label">{option.label}</span>
              {appearance === 'cards' ? (
                <span className="choice-check" aria-hidden="true">
                  {selectionIndicator}
                </span>
              ) : null}
              {option.description ? (
                <span className="choice-description">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
