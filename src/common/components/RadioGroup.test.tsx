import { useState } from 'react'
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { RadioGroup } from '@common/components/RadioGroup'

const options = [
  { value: 'first', label: '1. 첫 번째 보기' },
  { value: 'second', label: '2. 두 번째 보기' }
] as const

const TestRadioGroup = (): ReactElement => {
  const [value, setValue] = useState<string>()

  return (
    <RadioGroup
      name="answer"
      legend="정답 보기"
      options={options}
      value={value}
      onValueChange={setValue}
    />
  )
}

describe('RadioGroup', () => {
  it('전체 라벨을 클릭하면 선택 상태를 노출한다', async () => {
    const user = userEvent.setup()
    render(<TestRadioGroup />)

    const firstOption = screen.getByRole('radio', {
      name: '1. 첫 번째 보기'
    })

    expect(firstOption).not.toBeChecked()
    await user.click(screen.getByText('1. 첫 번째 보기'))
    expect(firstOption).toBeChecked()
  })
})
