import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'

export const useClearGuestPracticeQueryCache = (): (() => void) => {
  const queryClient = useQueryClient()

  return useCallback(() => {
    queryClient.removeQueries({
      queryKey: serverStateQueryKeys.study.all()
    })
  }, [queryClient])
}
