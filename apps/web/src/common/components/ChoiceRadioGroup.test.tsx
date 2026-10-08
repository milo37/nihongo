import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { ChoiceRadioGroup } from '@common/components/ChoiceRadioGroup'

const ChoiceHarness = ({
  disabled = false
}: {
  disabled?: boolean
}): ReactElement => {
  const [value, setValue] = useState('first')
  return (
    <ChoiceRadioGroup
      name="subject"
      legend="과목"
      value={value}
      onValueChange={setValue}
      selectionIndicator={<span aria-hidden="true" />}
      disabled={disabled}
      options={[
        { value: 'first', label: '어휘' },
        { value: 'second', label: '문법' },
        {
          value: 'locked',
          label: '독해',
          description: '로그인 필요',
          disabled: true
        }
      ]}
    />
  )
}

it('exposes one native selection and preserves a locked option when clicking labels', async () => {
  const user = userEvent.setup()
  render(<ChoiceHarness />)
  const group = screen.getByRole('group', { name: '과목' })
  const first = within(group).getByRole('radio', { name: '어휘' })
  const second = within(group).getByRole('radio', { name: '문법' })
  const locked = within(group).getByRole('radio', { name: '독해 로그인 필요' })
  expect(first).toBeChecked()
  await user.click(screen.getByText('문법'))
  expect(second).toBeChecked()
  expect(first).not.toBeChecked()
  expect(locked).toBeDisabled()
  await user.click(screen.getByText('독해'))
  expect(locked).not.toBeChecked()
  expect(second).toBeChecked()
})

it('locks the entire group during settlement without losing the selected value', async () => {
  const user = userEvent.setup()
  render(<ChoiceHarness disabled />)
  screen.getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled())
  await user.click(screen.getByText('문법'))
  expect(screen.getByRole('radio', { name: '어휘' })).toBeChecked()
  expect(screen.getByRole('radio', { name: '문법' })).not.toBeChecked()
})
