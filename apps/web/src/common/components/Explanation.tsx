import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'

type ExplanationProps = {
  readonly explanationJa: string | null
  readonly explanationKo: string
}

const hasJapaneseExplanation = (
  value: string | null | undefined
): value is string => typeof value === 'string' && value.trim().length > 0

// Operator, 2026-11-22: one explanation in the screen's language, no tabs.
// A Japanese screen without a Japanese explanation shows the Korean one and
// says why. The text keeps its line breaks.
export const Explanation = ({
  explanationJa,
  explanationKo
}: ExplanationProps): ReactElement => {
  const { t, i18n } = useTranslation('common')
  const isJapaneseScreen = i18n.resolvedLanguage === 'ja'
  const showJa = isJapaneseScreen && hasJapaneseExplanation(explanationJa)
  return (
    <div className="explanation">
      <p
        className="explanation-text"
        lang={showJa ? 'ja' : 'ko'}
      >
        {showJa ? explanationJa : explanationKo}
      </p>
      {isJapaneseScreen && !showJa ? (
        <p className="explanation-note">
          {t('explanation.japaneseUnavailable')}
        </p>
      ) : null}
    </div>
  )
}
