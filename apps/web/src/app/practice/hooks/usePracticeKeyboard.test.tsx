import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { usePracticeKeyboard } from '@app/practice/hooks/usePracticeKeyboard'

interface PracticeKeyboardFixtureProps {
  readonly enabled?: boolean
  readonly onNext: () => void
  readonly onPrevious: () => void
  readonly onSelectOption: (optionId: string) => void
  readonly onSubmit: () => void
  readonly submitEnabled?: boolean
}

const optionIds = ['option-1', 'option-2', 'option-3', 'option-4']

const PracticeKeyboardFixture = ({
  enabled,
  onNext,
  onPrevious,
  onSelectOption,
  onSubmit,
  submitEnabled
}: PracticeKeyboardFixtureProps): ReactElement => {
  usePracticeKeyboard({
    enabled,
    onNext,
    onPrevious,
    onSelectOption,
    onSubmit,
    optionIds,
    submitEnabled
  })

  return (
    <div>
      <input aria-label="한 줄 입력" />
      <textarea aria-label="여러 줄 입력" />
      <select aria-label="선택 입력" defaultValue="one">
        <option value="one">하나</option>
      </select>
      <div aria-label="편집 영역" contentEditable role="textbox" />
    </div>
  )
}

const createCallbacks = () => ({
  onNext: vi.fn(),
  onPrevious: vi.fn(),
  onSelectOption: vi.fn(),
  onSubmit: vi.fn()
})

describe('usePracticeKeyboard', () => {
  it('maps option, navigation, and submit shortcuts while suppressing editable targets', () => {
    const callbacks = createCallbacks()
    render(<PracticeKeyboardFixture {...callbacks} submitEnabled />)

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: '4' })
    fireEvent.keyDown(window, { key: '5' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { ctrlKey: true, key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

    expect(callbacks.onSelectOption.mock.calls).toEqual([
      ['option-1'],
      ['option-4']
    ])
    expect(callbacks.onPrevious).toHaveBeenCalledTimes(1)
    expect(callbacks.onNext).toHaveBeenCalledTimes(1)
    expect(callbacks.onSubmit).toHaveBeenCalledTimes(2)

    const editableTargets = [
      screen.getByRole('textbox', { name: '한 줄 입력' }),
      screen.getByRole('textbox', { name: '여러 줄 입력' }),
      screen.getByRole('combobox', { name: '선택 입력' }),
      screen.getByRole('textbox', { name: '편집 영역' })
    ]
    for (const target of editableTargets) {
      fireEvent.keyDown(target, { key: '1' })
      fireEvent.keyDown(target, { key: 'ArrowRight' })
      fireEvent.keyDown(target, { ctrlKey: true, key: 'Enter' })
    }

    expect(callbacks.onSelectOption).toHaveBeenCalledTimes(2)
    expect(callbacks.onPrevious).toHaveBeenCalledTimes(1)
    expect(callbacks.onNext).toHaveBeenCalledTimes(1)
    expect(callbacks.onSubmit).toHaveBeenCalledTimes(2)
  })

  it('blocks every shortcut when disabled and only submit shortcuts when submission is disabled', () => {
    const callbacks = createCallbacks()
    const view = render(
      <PracticeKeyboardFixture {...callbacks} enabled={false} submitEnabled />
    )

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { ctrlKey: true, key: 'Enter' })
    expect(callbacks.onSelectOption).not.toHaveBeenCalled()
    expect(callbacks.onPrevious).not.toHaveBeenCalled()
    expect(callbacks.onNext).not.toHaveBeenCalled()
    expect(callbacks.onSubmit).not.toHaveBeenCalled()

    view.rerender(
      <PracticeKeyboardFixture {...callbacks} enabled submitEnabled={false} />
    )
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { ctrlKey: true, key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

    expect(callbacks.onSelectOption).toHaveBeenCalledWith('option-1')
    expect(callbacks.onPrevious).toHaveBeenCalledTimes(1)
    expect(callbacks.onNext).toHaveBeenCalledTimes(1)
    expect(callbacks.onSubmit).not.toHaveBeenCalled()
  })
})
