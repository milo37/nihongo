import { useQuery } from '@tanstack/react-query'
import { connectionQueries } from '@app/development/queries/connectionQueries'

export const useConnectionStatus = () => {
  const query = useQuery(connectionQueries.live())
  const status =
    query.isFetching || query.isPending
      ? 'checking'
      : query.isError
        ? 'failed'
        : 'connected'
  return {
    status,
    retry: () => {
      if (!query.isFetching) void query.refetch()
    }
  } as const
}
