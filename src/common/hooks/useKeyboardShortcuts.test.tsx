import { useState } from 'react'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { useKeyboardShortcuts } from '@common/hooks/useKeyboardShortcuts'

const ShortcutFixture = (): ReactElement => {
  const [triggerCount, setTriggerCount] = useState(0)

  useKeyboardShortcuts([
    {
      key: '1',
      onTrigger: () => setTriggerCount((count) => count + 1)
    }
  ])

  return (
    <div>
      <p aria-live="polite">실행 횟수 {triggerCount}</p>
      <label htmlFor="memo">메모</label>
      <textarea id="memo" name="memo" />
    </div>
  )
}

describe('useKeyboardShortcuts', () => {
  it('등록된 숫자 키를 처리한다', () => {
    render(<ShortcutFixture />)

    fireEvent.keyDown(window, { key: '1' })

    expect(screen.getByText('실행 횟수 1')).toBeInTheDocument()
  })

  it('텍스트 입력 중에는 단축키를 처리하지 않는다', () => {
    render(<ShortcutFixture />)

    const memo = screen.getByRole('textbox', { name: '메모' })
    memo.focus()
    fireEvent.keyDown(memo, { key: '1' })

    expect(screen.getByText('실행 횟수 0')).toBeInTheDocument()
  })
})
