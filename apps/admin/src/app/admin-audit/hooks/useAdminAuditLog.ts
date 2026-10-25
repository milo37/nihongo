import { useInfiniteQuery } from '@tanstack/react-query'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'

export const useAdminAuditLog = () => {
  const { user, role, isReady } = useAuth()
  return useInfiniteQuery({
    ...adminAuditQueries.connection(user?.id ?? null),
    enabled: isReady && role === 'ADMIN' && Boolean(user?.id)
  })
}
