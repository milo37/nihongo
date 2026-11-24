import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { adminRetentionQueries } from '@app/admin-retention/queries/adminRetentionQueries'

export const useAdminRetention = () => {
  const { user, role, isReady } = useAuth()
  return useQuery({
    ...adminRetentionQueries.table(user?.id ?? null),
    enabled: isReady && role === 'ADMIN' && Boolean(user?.id)
  })
}
