import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { PracticePage } from '@app/practice/page'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'

const protectedModes = [
  ['BOOKMARK', '즐겨찾기'],
  ['DAILY_REVIEW', '오늘의 복습'],
  ['WRONG_NOTE', '오답 문제']
] as const

describe('PracticePage guest mode boundary', () => {
  it.each(protectedModes)(
    'direct %s 요청을 RANDOM으로 바꾸지 않고 로그인 경계에서 막는다',
    async (mode, label) => {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false }
        }
      })
      const router = createMemoryRouter(
        [
          {
            path: '/practice',
            element: (
              <ProtectedRouteProvider>
                <PracticePage />
              </ProtectedRouteProvider>
            )
          }
        ],
        { initialEntries: [`/practice?mode=${mode}`] }
      )

      render(
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      )

      expect(
        await screen.findByRole('button', { name: new RegExp(`^${label}`) })
      ).toHaveAttribute('aria-pressed', 'true')
      expect(
        screen.getByRole('button', { name: /^랜덤 문제/u })
      ).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('alert')).toHaveTextContent(
        '랜덤 문제로 바꾸지 않았습니다.'
      )
      screen.getAllByRole('link', { name: '로그인하기' }).forEach((link) => {
        expect(link).toHaveAttribute(
          'href',
          `/login?redirect=${encodeURIComponent(`/practice?mode=${mode}`)}`
        )
      })
      expect(
        screen.getByRole('button', { name: '학습 시작하기' })
      ).toBeDisabled()
    }
  )
})
