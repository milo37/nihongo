import { Suspense } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { operationsRoutes } from '@app/operations/router'
import { InformationFooter } from '@common/components/InformationFooter'
import { writeUiLocalePreference } from '@libs/localeStorage'
import { I18nProvider } from '@provider/I18nProvider'

const renderInformationRoute = (initialEntry: string) => {
  const router = createMemoryRouter(operationsRoutes, {
    initialEntries: [initialEntry]
  })
  const view = render(
    <I18nProvider>
      <Suspense fallback={null}>
        <RouterProvider router={router} />
      </Suspense>
    </I18nProvider>
  )
  return { router, ...view }
}

it.each([
  ['/legal#privacy', '이용 안내', ['terms', 'privacy', 'copyright']],
  ['/account/data#deletion', '계정·데이터 안내', ['deletion', 'data-export']],
  ['/support#contact', '문제 신고·문의 안내', ['question-report', 'contact']]
] as const)(
  'opens a public deep link %s with only its own contents',
  async (entry, title, sectionIds) => {
    const { router } = renderInformationRoute(entry)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      title
    )
    const navigation = screen.getByRole('navigation', { name: '서비스 안내' })
    const current = within(navigation)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute('href', router.state.location.pathname)
    const toc = screen.getByRole('navigation', { name: '이 페이지 목차' })
    expect(
      within(toc)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
    ).toEqual(sectionIds.map((id) => `${router.state.location.pathname}#${id}`))
    for (const id of sectionIds) {
      expect(document.getElementById(id)).toHaveAttribute('tabindex', '-1')
    }
    expect(
      document.getElementById(router.state.location.hash.slice(1))
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  }
)

it('connects the existing footer, page links, hash navigation and browser Back', async () => {
  const user = userEvent.setup()
  const router = createMemoryRouter(
    [{ path: '/entry', element: <InformationFooter /> }, ...operationsRoutes],
    { initialEntries: ['/entry'] }
  )
  render(
    <I18nProvider>
      <Suspense fallback={null}>
        <RouterProvider router={router} />
      </Suspense>
    </I18nProvider>
  )
  await user.click(screen.getByRole('link', { name: '이용 안내' }))
  await screen.findByRole('heading', { level: 1, name: '이용 안내' })
  await user.click(screen.getByRole('link', { name: '개인정보 안내' }))
  expect(router.state.location.pathname).toBe('/legal')
  expect(router.state.location.hash).toBe('#privacy')
  await user.click(screen.getByRole('link', { name: '계정·데이터' }))
  await screen.findByRole('heading', { level: 1, name: '계정·데이터 안내' })
  expect(router.state.location.hash).toBe('')
  expect(
    screen.queryByRole('link', { name: '개인정보 안내' })
  ).not.toBeInTheDocument()
  await act(async () => {
    await router.navigate(-1)
  })
  await screen.findByRole('heading', { level: 1, name: '이용 안내' })
  expect(router.state.location.hash).toBe('#privacy')
})

it('keeps unsupported data actions distinct from requests or completion', async () => {
  const { container } = renderInformationRoute('/account/data')
  await screen.findByRole('heading', { level: 1 })
  expect(
    screen.getByText('현재 이 화면에서는 계정 삭제를 신청할 수 없습니다.')
  ).toBeInTheDocument()
  expect(
    screen.getByText('현재 이 화면에서는 학습 데이터를 내려받을 수 없습니다.')
  ).toBeInTheDocument()
  expect(screen.getAllByText('현재 미지원')).toHaveLength(2)
  expect(container.querySelector('form')).not.toBeInTheDocument()
  expect(container.querySelector('[download]')).not.toBeInTheDocument()
})

it('explains the existing report boundary without adding a contact or report form', async () => {
  const { container } = renderInformationRoute('/support')
  await screen.findByRole('heading', { level: 1 })
  expect(screen.getByText(/6개 사유 중 하나/)).toHaveTextContent(
    '설명은 필수이며 최대 2,000자입니다.'
  )
  expect(
    screen.getByText('이 화면에서는 문의를 접수하지 않습니다.')
  ).toBeInTheDocument()
  expect(container.querySelector('form')).not.toBeInTheDocument()
  expect(container.querySelector('a[href^="mailto:"]')).not.toBeInTheDocument()
  expect(
    screen.getByText('일부 운영 정보는 아직 확인이 필요합니다.')
  ).toBeInTheDocument()
})

it('keeps Japanese page and contents links localized at the same public URL', async () => {
  expect(writeUiLocalePreference('ja')).toBe(true)
  const { router } = renderInformationRoute('/support#question-report')
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
    '問題報告・お問い合わせの案内'
  )
  expect(
    screen.getByRole('navigation', { name: 'サービス案内' })
  ).toBeInTheDocument()
  expect(
    within(
      screen.getByRole('navigation', { name: 'このページの目次' })
    ).getByRole('link', { name: '問題内容の報告' })
  ).toHaveAttribute('href', '/support#question-report')
  expect(router.state.location.pathname).toBe('/support')
  expect(router.state.location.hash).toBe('#question-report')
  expect(screen.getByText(/6つの理由から/)).toHaveTextContent(
    '説明は必須で、最大2,000文字です。'
  )
})
