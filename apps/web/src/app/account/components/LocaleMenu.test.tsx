import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { Layout } from '@app/layout'
import { appI18n } from '@nihongo/browser/i18n/config'
import { UI_LOCALE_STORAGE_KEY } from '@nihongo/browser/libs/localeStorage'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'

vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ isReady: true, role: 'GUEST', user: null })
}))

const renderLayout = (): ReturnType<typeof render> =>
  render(
    <I18nProvider>
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    </I18nProvider>
  )
const button = (): HTMLElement =>
  within(screen.getByRole('banner')).getByRole('button', {
    name: appI18n.t('common:locale.change')
  })
const item = (name: string): HTMLElement =>
  screen.getByRole('menuitemradio', { name })

beforeEach(async () => {
  window.localStorage.clear()
  await appI18n.changeLanguage('ko')
})

it('opens on the current language with a check, and the arrows wrap', async () => {
  renderLayout()
  const trigger = button()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  const menu = screen.getByRole('menu', { name: '언어' })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(trigger).toHaveAttribute('aria-controls', menu.id)
  expect(item('한국어')).toHaveFocus()
  expect(item('한국어')).toHaveAttribute('aria-checked', 'true')
  expect(item('한국어')).toHaveAttribute('lang', 'ko')
  expect(item('日本語')).toHaveAttribute('aria-checked', 'false')
  expect(item('日本語')).toHaveAttribute('lang', 'ja')
  expect(item('한국어').querySelector('svg')).not.toBeNull()
  expect(item('日本語').querySelector('svg')).toBeNull()
  await userEvent.keyboard('{ArrowDown}')
  expect(item('日本語')).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  expect(item('한국어')).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}')
  expect(item('日本語')).toHaveFocus()
  await userEvent.keyboard('{Home}')
  expect(item('한국어')).toHaveFocus()
  await userEvent.keyboard('{End}')
  expect(item('日本語')).toHaveFocus()
  // Escape closes without a change and returns focus.
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(document.documentElement.lang).toBe('ko')
  // Arrow up opens on the last item, arrow down on the current one.
  await userEvent.keyboard('{ArrowUp}')
  expect(item('日本語')).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await userEvent.keyboard('{ArrowDown}')
  expect(item('한국어')).toHaveFocus()
})

it('switches with Enter, keeps it after a reload, and only closes on the current one', async () => {
  const { unmount } = renderLayout()
  button().focus()
  await userEvent.keyboard('{Enter}{ArrowDown}{Enter}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(document.documentElement.lang).toBe('ja')
  expect(button()).toHaveAccessibleName('言語を変更')
  expect(button()).toHaveFocus()
  expect(window.localStorage.getItem(UI_LOCALE_STORAGE_KEY)).toContain('ja')
  unmount()
  await appI18n.changeLanguage('ko')
  renderLayout()
  expect(document.documentElement.lang).toBe('ja')
  await userEvent.click(button())
  expect(item('日本語')).toHaveAttribute('aria-checked', 'true')
  await userEvent.keyboard('{ArrowUp} ')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(document.documentElement.lang).toBe('ja')
})

// JLP-849: iOS Safari rings any item focused by script, so a tap or click
// focuses the menu box; the arrows still reach the items from there.
it('focuses the menu box, not an item, when opened by a click', async () => {
  renderLayout()
  await userEvent.click(button())
  const menu = screen.getByRole('menu', { name: '언어' })
  expect(menu).toHaveFocus()
  expect(menu).toHaveAttribute('tabindex', '-1')
  await userEvent.keyboard('{ArrowUp}')
  expect(item('日本語')).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(button())
  await userEvent.keyboard('{ArrowDown}')
  expect(item('한국어')).toHaveFocus()
})

it('closes on an outside click and on Tab, and never opens with the account menu', async () => {
  renderLayout()
  await userEvent.click(button())
  expect(screen.getByRole('menu')).toBeInTheDocument()
  await userEvent.click(document.body)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(document.documentElement.lang).toBe('ko')

  button().focus()
  await userEvent.keyboard('{Enter}')
  await userEvent.tab()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()

  const account = screen.getByRole('button', { name: '로그인' })
  await userEvent.click(account)
  expect(account).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(button())
  expect(account).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getAllByRole('menu')).toHaveLength(1)
  await userEvent.click(account)
  expect(button()).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getAllByRole('menu')).toHaveLength(1)
})
