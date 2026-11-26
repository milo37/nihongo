import { act, render, screen } from '@testing-library/react'
import { Explanation } from '@common/components/Explanation'
import { appI18n } from '@nihongo/browser/i18n/config'

const explanationKo = '「山」은 やま라고 읽습니다.\n두 번째 줄입니다.'
const explanationJa = '「山」は「やま」と読みます。\n二行目です。'

// The text is still mounted here, so the switch back is a React update.
afterEach(async () => {
  await act(() => appI18n.changeLanguage('ko'))
})

it('shows only the Korean explanation on a Korean screen, with no tabs', async () => {
  await appI18n.changeLanguage('ko')
  render(
    <Explanation explanationJa={explanationJa} explanationKo={explanationKo} />
  )

  expect(screen.queryByRole('tab')).toBeNull()
  const text = screen.getByText(/やま라고 읽습니다/u)
  expect(text).toHaveAttribute('lang', 'ko')
  expect(text.textContent).toBe(explanationKo)
  expect(text).toHaveClass('explanation-text')
  expect(screen.queryByText(/やま」と読みます/u)).toBeNull()
})

it('shows only the Japanese explanation on a Japanese screen, and follows a language change', async () => {
  await appI18n.changeLanguage('ja')
  render(
    <Explanation explanationJa={explanationJa} explanationKo={explanationKo} />
  )

  expect(screen.queryByRole('tab')).toBeNull()
  const text = screen.getByText(/やま」と読みます/u)
  expect(text).toHaveAttribute('lang', 'ja')
  expect(text.textContent).toBe(explanationJa)
  expect(
    screen.queryByText(appI18n.t('common:explanation.japaneseUnavailable'))
  ).toBeNull()

  await act(() => appI18n.changeLanguage('ko'))
  expect(screen.getByText(/やま라고 읽습니다/u)).toHaveAttribute('lang', 'ko')
})

it('falls back to the Korean explanation on a Japanese screen when there is no Japanese one', async () => {
  await appI18n.changeLanguage('ja')
  render(<Explanation explanationJa={null} explanationKo={explanationKo} />)

  expect(screen.getByText(/やま라고 읽습니다/u)).toHaveAttribute('lang', 'ko')
  expect(
    screen.getByText(appI18n.t('common:explanation.japaneseUnavailable'))
  ).toBeVisible()
})
