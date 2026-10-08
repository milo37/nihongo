import type { QueryClient } from '@tanstack/react-query'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'

const refetchTimers = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>()

export const settleBookmarkMutation = async (
  queryClient: QueryClient,
  isCurrentAction: () => boolean
): Promise<void> => {
  await queryClient.invalidateQueries({
    queryKey: bookmarkQueries.allKey(),
    refetchType: 'none'
  })

  const scheduledTimer = refetchTimers.get(queryClient)
  if (scheduledTimer) clearTimeout(scheduledTimer)

  const timer = setTimeout(() => {
    refetchTimers.delete(queryClient)
    if (!isCurrentAction()) return
    const hasPendingBookmarkMutation =
      queryClient.getMutationCache().findAll({
        mutationKey: bookmarkQueries.allKey(),
        status: 'pending'
      }).length > 0
    if (hasPendingBookmarkMutation) return
    void queryClient
      .refetchQueries({
        queryKey: bookmarkQueries.allKey(),
        type: 'active'
      })
      .catch(() => undefined)
  }, 0)
  refetchTimers.set(queryClient, timer)
}
