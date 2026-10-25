import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'

import { Tabs } from '@common/components/Tabs'

type ExplanationLanguagePanelProps = {
  readonly explanationJa: string | null
  readonly explanationKo: string
}

export const hasJapaneseExplanation = (
  value: string | null | undefined
): value is string => typeof value === 'string' && value.trim().length > 0

export const ExplanationLanguagePanel = ({
  explanationJa,
  explanationKo
}: ExplanationLanguagePanelProps): ReactElement => {
  const { t } = useTranslation('common')

  if (!hasJapaneseExplanation(explanationJa)) {
    return (
      <div className="min-w-0">
        <p className="break-words leading-7 text-muted" lang="ko">
          {explanationKo}
        </p>
        <p className="mt-3 text-sm font-semibold text-subtle">
          {t('explanation.japaneseUnavailable')}
        </p>
      </div>
    )
  }

  return (
    <Tabs
      defaultValue="ko"
      label={t('explanation.languageLabel')}
      tabs={[
        {
          id: 'ko',
          label: t('locale.ko'),
          panel: (
            <p className="break-words leading-7 text-muted" lang="ko">
              {explanationKo}
            </p>
          )
        },
        {
          id: 'ja',
          label: t('locale.ja'),
          panel: (
            <p className="break-words leading-7 text-muted" lang="ja">
              {explanationJa}
            </p>
          )
        }
      ]}
    />
  )
}
