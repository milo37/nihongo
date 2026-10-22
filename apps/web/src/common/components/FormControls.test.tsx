import { render, screen } from '@testing-library/react'
import { Input } from '@common/components/Input'
import { Textarea } from '@common/components/Textarea'

describe('shared form control instructions', () => {
  it('shows a localized non-color required instruction for inputs', () => {
    render(<Input label="이메일" name="email" required />)

    const input = screen.getByRole('textbox', { name: '이메일' })
    expect(input).toBeRequired()
    expect(screen.getByText('(필수)')).toBeVisible()
  })

  it('shows a localized non-color required instruction for textareas', () => {
    render(<Textarea label="처리 사유" name="reason" required />)

    const textarea = screen.getByRole('textbox', { name: '처리 사유' })
    expect(textarea).toBeRequired()
    expect(screen.getByText('(필수)')).toBeVisible()
  })
})
