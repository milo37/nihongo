import { useMutationState } from '@tanstack/react-query'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'

interface BookmarkMutationActivity {
  isPaused: boolean
  pendingQuestionIds: ReadonlySet<string>
}

const readQuestionId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || !('questionId' in value)) {
    return null
  }
  return typeof value.questionId === 'string' ? value.questionId : null
}

export const useBookmarkMutationActivity = (): BookmarkMutationActivity => {
  const states = useMutationState({
    filters: {
      mutationKey: bookmarkQueries.allKey(),
      status: 'pending'
    },
    select: (mutation) => ({
      isPaused: mutation.state.isPaused,
      questionId: readQuestionId(mutation.state.variables)
    })
  })

  return {
    isPaused: states.some(({ isPaused }) => isPaused),
    pendingQuestionIds: new Set(
      states.flatMap(({ questionId }) =>
        questionId === null ? [] : [questionId]
      )
    )
  }
}
