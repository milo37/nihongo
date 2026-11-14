import { act, render, screen } from '@testing-library/react'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import { appI18n } from '@nihongo/browser/i18n/config'

const explanationKo = '「山」은 やま라고 읽습니다.'
const explanationJa = '「山」は「やま」と読みます。'

// The panel is still mounted here, so the switch back is a React update.
afterEach(async () => {
  await act(() => appI18n.changeLanguage('ko'))
})

it('opens on the Korean explanation on a Korean screen', async () => {
  await appI18n.changeLanguage('ko')
  render(
    <ExplanationLanguagePanel
      explanationJa={explanationJa}
      explanationKo={explanationKo}
    />
  )

  expect(screen.getByRole('tab', { name: '한국어' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByText(explanationKo)).toBeVisible()
})

it('opens on the Japanese explanation on a Japanese screen, and follows a language change', async () => {
  await appI18n.changeLanguage('ja')
  render(
    <ExplanationLanguagePanel
      explanationJa={explanationJa}
      explanationKo={explanationKo}
    />
  )

  expect(screen.getByRole('tab', { name: '日本語' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByText(explanationJa)).toHaveAttribute('lang', 'ja')

  await act(() => appI18n.changeLanguage('ko'))
  expect(screen.getByRole('tab', { name: '한국어' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

it('falls back to the Korean explanation on a Japanese screen when there is no Japanese one', async () => {
  await appI18n.changeLanguage('ja')
  render(
    <ExplanationLanguagePanel
      explanationJa={null}
      explanationKo={explanationKo}
    />
  )

  expect(screen.queryByRole('tab')).toBeNull()
  expect(screen.getByText(explanationKo)).toHaveAttribute('lang', 'ko')
  expect(
    screen.getByText(appI18n.t('common:explanation.japaneseUnavailable'))
  ).toBeVisible()
})
