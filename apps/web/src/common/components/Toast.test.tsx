import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@common/components/Button'
import { ToastProvider, useToast } from '@common/components/Toast'

const ToastHarness = () => {
  const { addToast } = useToast()
  return (
    <Button
      onClick={() =>
        addToast({
          title: '저장 완료',
          description: '변경사항을 저장했습니다.'
        })
      }
    >
      알림 만들기
    </Button>
  )
}

describe('ToastProvider', () => {
  it('labels a non-empty toast region with an allowed landmark role', async () => {
    const interaction = userEvent.setup()
    render(
      <ToastProvider defaultDurationMs={Number.POSITIVE_INFINITY}>
        <ToastHarness />
      </ToastProvider>
    )

    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    await interaction.click(screen.getByRole('button', { name: '알림 만들기' }))

    expect(screen.getByRole('region', { name: '알림' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('저장 완료')
  })
})
