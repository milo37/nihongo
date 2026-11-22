import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { usePracticeResultController } from '@app/practice/hooks/usePracticeResultController'
import { ResultQuestionDetail } from '@app/practice/result/ResultQuestionDetail'
import { ResultQuestionNavigation } from '@app/practice/result/ResultQuestionNavigation'

export type ResultController = ReturnType<typeof usePracticeResultController>
type ResultItem = NonNullable<ResultController['selectedItem']>

/** Question navigation above the selected question's detail. */
export const SelectedResultItem = ({
  result,
  items,
  item
}: {
  result: ResultController
  items: readonly ResultItem[]
  item: ResultItem
}): ReactElement => {
  const { t } = useTranslation('result')
  const { bookmark } = result
  return (
    <div className="study-result-layout">
      <ResultQuestionNavigation
        items={items}
        selectedQuestionId={item.question.id}
        onSelect={result.selectQuestion}
      />
      <ResultQuestionDetail
        key={item.question.id}
        item={item}
        ordinal={result.selectedIndex + 1}
        canReport={result.role !== 'GUEST'}
        isBookmarked={result.selectedIsBookmarked}
        bookmarkDisabled={
          bookmark.isUnavailable || result.isResultSourceUnavailable
        }
        isResultSourceUnavailable={result.isResultSourceUnavailable}
        bookmarkMessage={
          bookmark.message?.questionId === item.question.id
            ? {
                text: t(`bookmark.${bookmark.message.code}`),
                isError: bookmark.message.code !== 'unavailable'
              }
            : null
        }
        onToggleBookmark={result.toggleSelectedBookmark}
      />
    </div>
  )
}
