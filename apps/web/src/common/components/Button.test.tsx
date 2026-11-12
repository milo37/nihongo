import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'

const Pending = ({ onClick }: { onClick: () => void }): ReactElement => {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      isLoading={busy}
      loadingLabel="보내는 중…"
      onClick={() => {
        onClick()
        setBusy(true)
      }}
    >
      보내기
    </Button>
  )
}

describe('JLP-846 busy Button', () => {
  it('keeps keyboard focus while busy and ignores more activations', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<Pending onClick={onClick} />)
    await user.tab()
    await user.keyboard('{Enter}')
    const busy = screen.getByRole('button', { name: '보내는 중…' })
    expect(busy).toHaveFocus()
    expect(busy).not.toHaveAttribute('disabled')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveAttribute('aria-busy', 'true')
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    await user.click(busy)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not submit its form while busy', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault())
    const user = userEvent.setup()
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <Button type="submit" isLoading disabled>
          저장
        </Button>
      </form>
    )
    await user.click(screen.getByRole('button'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('stays natively disabled when disabled and not busy', () => {
    render(<Button disabled>저장</Button>)
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })
})
