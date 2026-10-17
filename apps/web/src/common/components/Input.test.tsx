import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { Input } from '@common/components/Input'

it('D505-B2 Input keeps keyboard focus, label association and editable value', async () => {
  const user = userEvent.setup()
  const change = vi.fn()
  render(<Input name="questionId" label="문제 ID" onChange={change} />)
  const input = screen.getByRole('textbox', { name: '문제 ID' })
  await user.tab()
  expect(input).toHaveFocus()
  await user.type(input, 'abc')
  expect(input).toHaveValue('abc')
  expect(change).toHaveBeenCalledTimes(3)
})

it('D505-B2 Input preserves error and hint descriptions when focus is requested', () => {
  const ref = createRef<HTMLInputElement>()
  render(
    <Input
      ref={ref}
      name="remediationVersionId"
      label="개선 버전 ID"
      hint="선택 입력"
      error="입력을 확인해 주세요."
    />
  )
  ref.current?.focus()
  const input = screen.getByRole('textbox', { name: '개선 버전 ID' })
  expect(input).toHaveFocus()
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAccessibleDescription('선택 입력 입력을 확인해 주세요.')
  expect(screen.getByRole('alert')).toHaveTextContent('입력을 확인해 주세요.')
})

it('D505-B2 Input keeps a disabled field out of the keyboard order', async () => {
  const user = userEvent.setup()
  render(
    <>
      <button>이전</button>
      <Input name="locked" label="잠긴 입력" disabled />
      <button>다음</button>
    </>
  )
  await user.tab()
  expect(screen.getByRole('button', { name: '이전' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('textbox', { name: '잠긴 입력' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '다음' })).toHaveFocus()
})
