import { queryOptions } from '@tanstack/react-query'
import { getHealthLive } from '@api/development/getHealthLive'

export const connectionQueries = {
  allKey: () => ['development-connection'] as const,
  live: () =>
    queryOptions({
      queryKey: [...connectionQueries.allKey(), 'health-live'],
      queryFn: ({ signal }) => getHealthLive(signal),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: 'always',
      refetchInterval: false,
      networkMode: 'always',
      gcTime: 0
    })
}
