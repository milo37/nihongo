import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Select } from '@common/components/Select'

describe('Select', () => {
  it('moves across enabled options with keyboard navigation keys', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <Select
        defaultValue=""
        label="과목"
        name="subject"
        onChange={handleChange}
      >
        <option value="">전체 과목</option>
        <option value="VOCABULARY" disabled>
          문자·어휘
        </option>
        <option value="GRAMMAR">문법</option>
        <option value="READING">독해</option>
      </Select>
    )
    const select = screen.getByRole('combobox', { name: '과목' })

    select.focus()
    await user.keyboard('{ArrowDown}')
    expect(select).toHaveValue('GRAMMAR')
    await user.keyboard('{End}')
    expect(select).toHaveValue('READING')
    await user.keyboard('{Home}')
    expect(select).toHaveValue('')
    expect(handleChange).toHaveBeenCalledTimes(3)
  })
})
