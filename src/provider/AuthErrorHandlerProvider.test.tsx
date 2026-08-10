import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { emitApiError } from '@libs/errorBus'
import { AuthErrorHandlerProvider } from '@provider/AuthErrorHandlerProvider'

describe('AuthErrorHandlerProvider', () => {
  it('전역 errorBus의 네트워크 오류를 접근 가능한 배너로 알린다', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: <AuthErrorHandlerProvider />
        }
      ],
      { initialEntries: ['/practice?mode=RANDOM'] }
    )

    render(<RouterProvider router={router} />)

    act(() => {
      emitApiError(
        Object.assign(new Error('Network Error'), {
          isNetworkError: true,
          isOffline: false
        })
      )
    })

    const banner = screen.getByRole('status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(banner).toHaveTextContent(
      '네트워크 연결이 원활하지 않습니다. 다시 시도해 주세요.'
    )

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
