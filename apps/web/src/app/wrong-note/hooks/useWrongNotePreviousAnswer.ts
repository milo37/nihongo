import { useEffect } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { matchWrongNotePreviousAnswer } from '@app/wrong-note/adapters/wrongNotePreviousAnswer'
import type { WrongNotePreviousAnswer } from '@app/wrong-note/adapters/wrongNotePreviousAnswer'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'

export const useWrongNotePreviousAnswer = (
  detail: WrongNoteDetailView | undefined
): WrongNotePreviousAnswer => {
  const enabled = Boolean(
    detail?.lastWrongQuestionVersionId &&
      detail.lastWrongQuestionVersionId === detail.question.questionVersionId
  )
  const history = useInfiniteQuery({
    ...wrongNoteQueries.reviewEvents(detail?.question.id ?? ''),
    enabled
  })
  const match = matchWrongNotePreviousAnswer(
    {
      lastWrongQuestionVersionId: enabled
        ? (detail?.lastWrongQuestionVersionId ?? null)
        : null,
      lastWrongAt: detail?.wrongNote.lastWrongAt ?? '',
      wrongCount: detail?.wrongNote.wrongCount ?? 0,
      optionIds: detail?.question.options.map(({ id }) => id) ?? []
    },
    history.data?.pages ?? []
  )
  const needsMore = enabled && match.status === 'needsMore'
  const { fetchNextPage, hasNextPage, isFetching, isError, fetchStatus } =
    history

  useEffect(() => {
    if (
      needsMore &&
      hasNextPage &&
      !isFetching &&
      !isError &&
      fetchStatus !== 'paused'
    ) {
      void fetchNextPage()
    }
  }, [needsMore, hasNextPage, isFetching, isError, fetchStatus, fetchNextPage])

  if (!enabled) return { status: 'unavailable' }
  if (match.status !== 'needsMore') return match
  if (isError) return { status: 'error' }
  if (fetchStatus === 'paused') return { status: 'paused' }
  return { status: 'loading' }
}
