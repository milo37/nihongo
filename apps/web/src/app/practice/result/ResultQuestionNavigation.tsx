import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { Button } from '@common/components/Button'
import { Icon } from '@common/components/Icon'
import { formatNumber } from '@libs/localeFormatters'
import { resolveUiLocale } from '@/i18n/types'

type ResultQuestionNavigationProps = {
  readonly items: readonly StudyResultItemView[]
  readonly selectedQuestionId: string
  readonly onSelect: (questionId: string) => void
}

export const ResultQuestionNavigation = ({
  items,
  selectedQuestionId,
  onSelect
}: ResultQuestionNavigationProps): ReactElement => {
  const { i18n, t } = useTranslation('result')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const navigationRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const ensureSelectedVisible = (): void => {
      const navigation = navigationRef.current
      if (!navigation || navigation.scrollWidth <= navigation.clientWidth)
        return
      const selected = navigation.querySelector<HTMLButtonElement>(
        'button[aria-pressed="true"]'
      )
      if (!selected) return
      const navigationRect = navigation.getBoundingClientRect()
      const selectedRect = selected.getBoundingClientRect()
      const style = window.getComputedStyle(navigation)
      const left =
        navigationRect.left + (Number.parseFloat(style.paddingLeft) || 0)
      const right =
        navigationRect.right - (Number.parseFloat(style.paddingRight) || 0)
      if (selectedRect.left < left) {
        navigation.scrollLeft += selectedRect.left - left
      } else if (selectedRect.right > right) {
        navigation.scrollLeft += selectedRect.right - right
      }
    }

    ensureSelectedVisible()
    window.addEventListener('resize', ensureSelectedVisible)
    return () => window.removeEventListener('resize', ensureSelectedVisible)
  }, [items, selectedQuestionId])

  return (
    <nav
      ref={navigationRef}
      className="study-result-questions"
      aria-label={t('navigation.label')}
    >
      {items.map((item, index) => {
        const selected = item.question.id === selectedQuestionId
        const status = item.isCorrect
          ? t('items.correct')
          : item.selectedOptionId === null
            ? t('items.unanswered')
            : t('items.incorrect')
        const label = t('navigation.question', {
          formattedOrdinal: formatNumber(index + 1, locale)
        })

        return (
          <Button
            key={item.question.id}
            variant="ghost"
            className="study-result-question"
            aria-label={`${label} · ${status}`}
            aria-pressed={selected}
            aria-controls="selected-result-question"
            onClick={() => onSelect(item.question.id)}
          >
            <Icon name={item.isCorrect ? 'circle-check' : 'circle-alert'} />
            <span>{label}</span>
          </Button>
        )
      })}
    </nav>
  )
}
