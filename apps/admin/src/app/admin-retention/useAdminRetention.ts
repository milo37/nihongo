import { queryOptions, useQuery } from '@tanstack/react-query'
import { getAdminRetention } from '@nihongo/browser/api/admin-retention/index'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

const adminRetentionQuery = (actorId: string | null) =>
  queryOptions({
    queryKey: ['admin-retention', actorId] as const,
    queryFn: getAdminRetention,
    staleTime: 60_000,
    retry: false
  })

export const useAdminRetention = () => {
  const { user, role, isReady } = useAuth()
  return useQuery({
    ...adminRetentionQuery(user?.id ?? null),
    enabled: isReady && role === 'ADMIN' && Boolean(user?.id)
  })
}
