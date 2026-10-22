import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ExplanationLanguagePanel,
  hasJapaneseExplanation
} from '@common/components/ExplanationLanguagePanel'
import { appI18n } from '@/i18n/config'

afterEach(async () => {
  cleanup()
  await act(async () => {
    await appI18n.changeLanguage('ko')
  })
})

describe('ExplanationLanguagePanel', () => {
  it.each([null, undefined, '', '   '])(
    '일본어 해설이 %s이면 selector 없이 한국어 fallback을 표시한다',
    (explanationJa) => {
      render(
        <ExplanationLanguagePanel
          explanationJa={explanationJa ?? null}
          explanationKo="한국어 해설"
        />
      )

      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
      expect(screen.getByText('한국어 해설')).toHaveAttribute('lang', 'ko')
      expect(
        screen.getByText('일본어 해설이 없어 한국어 해설을 표시합니다.')
      ).toBeVisible()
      expect(hasJapaneseExplanation(explanationJa)).toBe(false)
    }
  )

  it('UI locale이 일본어여도 한국어 해설을 기본으로 두고 일본어를 선택할 수 있다', async () => {
    const user = userEvent.setup()
    await act(async () => {
      await appI18n.changeLanguage('ja')
    })

    render(
      <ExplanationLanguagePanel
        explanationJa="日本語の解説"
        explanationKo="한국어 해설"
      />
    )

    const koreanTab = screen.getByRole('tab', { name: '한국어' })
    const japaneseTab = screen.getByRole('tab', { name: '日本語' })
    expect(koreanTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('한국어 해설')).toHaveAttribute('lang', 'ko')
    expect(screen.queryByText('日本語の解説')).not.toBeInTheDocument()

    await user.click(japaneseTab)

    expect(japaneseTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('日本語の解説')).toHaveAttribute('lang', 'ja')
    expect(hasJapaneseExplanation(' 日本語の解説 ')).toBe(true)
  })
})
