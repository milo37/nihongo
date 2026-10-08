import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router'
import type { ReactElement } from 'react'
import { Dialog } from '@common/components/Dialog'
import { LocaleSwitcher } from '@common/components/LocaleSwitcher'
import { useDocumentMetadata } from '@common/hooks/useDocumentMetadata'
import { queryClient } from '@libs/queryClient'
import {
  UI_LOCALE_STORAGE_KEY,
  writeUiLocalePreference
} from '@libs/localeStorage'
import { cachedStorage } from '@libs/storage'
import { I18nProvider } from '@provider/I18nProvider'
import { useAppStore } from '@store/index'

const LocaleProbe = (): ReactElement => {
  const { t } = useTranslation('home')

  return (
    <>
      <LocaleSwitcher />
      <h1>{t('hero.titleLine2')}</h1>
    </>
  )
}

const StatefulProbe = (): ReactElement => {
  const { t } = useTranslation('auth')
  const location = useLocation()
  const [value, setValue] = useState('')
  const [dialogOpen, setDialogOpen] = useState(true)
  useDocumentMetadata()

  return (
    <>
      <p data-testid="location">
        {location.pathname}
        {location.search}
        {location.hash}
      </p>
      <label>
        {t('fields.email')}
        <input
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      </label>
      <LocaleSwitcher />
      <Dialog
        open={dialogOpen}
        title={t('reset.title')}
        onOpenChange={setDialogOpen}
      >
        <p>phase9-draft</p>
      </Dialog>
    </>
  )
}

const renderProbe = (): ReturnType<typeof render> => {
  return render(
    <I18nProvider>
      <LocaleProbe />
    </I18nProvider>
  )
}

describe('I18nProvider', () => {
  it('Korean-first default와 saved Japanese preference를 재현한다', async () => {
    const firstRender = renderProbe()

    expect(screen.getByRole('heading')).toHaveTextContent(
      '끝까지 해결하는 학습'
    )
    expect(document.documentElement).toHaveAttribute('lang', 'ko')
    firstRender.unmount()

    expect(writeUiLocalePreference('ja')).toBe(true)
    renderProbe()

    expect(
      await screen.findByRole('heading', {
        name: '最後まで解決する学習'
      })
    ).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'ja')
  })

  it('사용자 전환을 저장하고 cross-tab event는 write-back 없이 반영한다', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(cachedStorage, 'setItem')
    renderProbe()

    await user.selectOptions(screen.getByLabelText('언어'), 'ja')
    expect(
      await screen.findByRole('heading', {
        name: '最後まで解決する学習'
      })
    ).toBeInTheDocument()
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(document.documentElement).toHaveAttribute('lang', 'ja')

    setItem.mockClear()
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: UI_LOCALE_STORAGE_KEY,
        newValue: '{"version":1,"locale":"ko"}'
      })
    )

    expect(
      await screen.findByRole('heading', {
        name: '끝까지 해결하는 학습'
      })
    ).toBeInTheDocument()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('저장 실패 시 Korean-first fail-safe를 locale과 document에 함께 적용한다', async () => {
    const user = userEvent.setup()
    expect(writeUiLocalePreference('ja')).toBe(true)
    vi.spyOn(cachedStorage, 'setItem').mockReturnValue(false)
    renderProbe()

    expect(
      await screen.findByRole('heading', {
        name: '最後まで解決する学習'
      })
    ).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('言語'), 'ko')

    expect(
      await screen.findByRole('heading', {
        name: '끝까지 해결하는 학습'
      })
    ).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'ko')
  })

  it('locale 전환 중 route/form/Query/Zustand 상태와 network를 보존한다', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const sentinel = { owner: 'locale-preservation' }
    queryClient.setQueryData(['phase9', 'sentinel'], sentinel)
    const queryStateBefore = queryClient.getQueryState(['phase9', 'sentinel'])
    useAppStore
      .getState()
      .beginPractice('phase9-session', '2026-09-28T00:00:00.000Z')
    useAppStore.getState().selectAnswer('question-1', 'option-2')

    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <MemoryRouter
            initialEntries={['/login?redirect=%2Fdashboard#credentials']}
          >
            <StatefulProbe />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>
    )

    const input = screen.getByLabelText('이메일')
    await user.type(input, 'learner@example.com')
    await user.selectOptions(screen.getByLabelText('언어'), 'ja')

    expect(await screen.findByLabelText('メールアドレス')).toHaveValue(
      'learner@example.com'
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleName('パスワード再設定')
    expect(screen.getByText('phase9-draft')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/login?redirect=%2Fdashboard#credentials'
    )
    expect(queryClient.getQueryData(['phase9', 'sentinel'])).toBe(sentinel)
    expect(queryClient.getQueryState(['phase9', 'sentinel'])).toMatchObject({
      dataUpdatedAt: queryStateBefore?.dataUpdatedAt,
      isInvalidated: false
    })
    expect(useAppStore.getState()).toMatchObject({
      sessionId: 'phase9-session',
      selectedAnswers: { 'question-1': 'option-2' }
    })
    expect(document.title).toBe('ログイン | JLPT Drill Note')
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.content
    ).toContain('JLPT N5')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
