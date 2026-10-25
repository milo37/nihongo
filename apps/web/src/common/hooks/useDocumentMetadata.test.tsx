import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Layout } from '@app/layout'
import { RouteErrorPage } from '@app/not-found/route-error'
import { useDocumentMetadata } from '@common/hooks/useDocumentMetadata'
import { appI18n } from '@/i18n/config'
import { I18nProvider, useUiLocale } from '@provider/I18nProvider'

vi.mock('@provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ isReady: true, role: 'GUEST', user: null })
}))

type RobotsValue = Parameters<typeof useDocumentMetadata>[0]['robots']

const MetadataProbe = ({ robots }: { robots: RobotsValue }): null => {
  useDocumentMetadata({ robots })
  return null
}

const probe = (robots: RobotsValue) => (
  <I18nProvider>
    <MemoryRouter>
      <MetadataProbe robots={robots} />
    </MemoryRouter>
  </I18nProvider>
)

const LocaleControl = () => {
  const { setLocale } = useUiLocale()
  return (
    <button type="button" onClick={() => setLocale('ja')}>
      Switch to Japanese
    </button>
  )
}

const renderApp = (entry = '/') => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Layout />,
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <LocaleControl /> },
          { path: 'login', element: <LocaleControl /> },
          { path: 'practice', element: <LocaleControl /> },
          { path: '*', element: <LocaleControl /> }
        ]
      }
    ],
    { initialEntries: [entry] }
  )
  render(
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  )
  return router
}

const robotsNodes = () =>
  document.head.querySelectorAll<HTMLMetaElement>('meta[name="robots" i]')

const expectRobots = (value: RobotsValue): HTMLMetaElement => {
  expect(robotsNodes()).toHaveLength(1)
  const node = robotsNodes()[0]
  if (!node) throw new Error('Expected one robots meta element')
  expect(node.name).toBe('robots')
  expect(node.content).toBe(value)
  return node
}

beforeEach(() => {
  robotsNodes().forEach((node) => node.remove())
})

afterEach(() => {
  cleanup()
  robotsNodes().forEach((node) => node.remove())
  document.head.querySelector('meta[name="metadata-test-unrelated"]')?.remove()
})

describe('document robots metadata', () => {
  it('keeps one normalized managed meta while preserving unrelated metadata', () => {
    const first = document.createElement('meta')
    first.name = 'ROBOTS'
    first.content = 'index,follow'
    const duplicate = document.createElement('meta')
    duplicate.name = 'robots'
    duplicate.content = 'index,follow'
    const unrelated = document.createElement('meta')
    unrelated.name = 'metadata-test-unrelated'
    unrelated.content = 'preserved'
    document.head.append(first, duplicate, unrelated)

    render(probe('noindex,follow'))

    expect(expectRobots('noindex,follow')).toBe(first)
    expect(unrelated).toBeInTheDocument()
    expect(unrelated.content).toBe('preserved')
  })

  it('updates the existing node when the caller changes policy on the same path', () => {
    const view = render(probe('index,follow'))
    const node = expectRobots('index,follow')
    view.rerender(probe('noindex,follow'))
    expect(expectRobots('noindex,follow')).toBe(node)
    view.rerender(probe('index,follow'))
    expect(expectRobots('index,follow')).toBe(node)
  })

  it('composes route policy through Layout and restores it on Back', async () => {
    const router = renderApp()
    const node = expectRobots('index,follow')

    await act(async () => {
      await router.navigate('/practice')
    })
    expect(expectRobots('noindex,follow')).toBe(node)
    await act(async () => {
      await router.navigate('/')
    })
    expect(expectRobots('index,follow')).toBe(node)
    await act(async () => {
      await router.navigate(-1)
    })
    expect(expectRobots('noindex,follow')).toBe(node)
  })

  it('preserves translated title, description and html language without duplicating robots', async () => {
    renderApp()
    const node = expectRobots('index,follow')
    expect(document.title).toBe(
      appI18n.t('navigation:documentTitle', {
        route: appI18n.t('navigation:routes.home')
      })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to Japanese' })
    )

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('ja')
      expect(appI18n.resolvedLanguage).toBe('ja')
      expect(document.title).toBe(
        appI18n.t('navigation:documentTitle', {
          route: appI18n.t('navigation:routes.home')
        })
      )
      expect(
        document.head.querySelector<HTMLMetaElement>('meta[name="description"]')
          ?.content
      ).toBe(appI18n.t('navigation:metaDescription'))
    })
    expect(expectRobots('index,follow')).toBe(node)
  })

  it('does not include query, fragment, actor or token fixtures in managed metadata', async () => {
    const router = renderApp(
      '/login?token=token-fixture&actor=actor-fixture#fragment-fixture'
    )
    const node = expectRobots('noindex,follow')
    await act(async () => {
      await router.navigate(
        '/login?token=second-token-fixture#second-fragment-fixture'
      )
    })
    expect(expectRobots('noindex,follow')).toBe(node)
    const markup = Array.from(
      document.head.querySelectorAll('title, meta, link')
    )
      .map((element) => element.outerHTML)
      .join('')
    for (const marker of [
      'token-fixture',
      'actor-fixture',
      'fragment-fixture'
    ]) {
      expect(markup).not.toContain(marker)
    }
  })

  it('forces noindex for the root error fallback even on the public home URL', async () => {
    const existing = document.createElement('meta')
    existing.name = 'robots'
    existing.content = 'index,follow'
    document.head.append(existing)
    const router = createMemoryRouter(
      [
        {
          path: '/',
          loader: () => {
            throw new Error('error-secret-fixture')
          },
          element: <p>Unreachable normal page</p>,
          errorElement: <RouteErrorPage />
        }
      ],
      { initialEntries: ['/'] }
    )
    render(
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    )
    await screen.findByRole('alert')
    expect(expectRobots('noindex,follow')).toBe(existing)
    expect(document.head.innerHTML).not.toContain('error-secret-fixture')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/practice')
  })
})
