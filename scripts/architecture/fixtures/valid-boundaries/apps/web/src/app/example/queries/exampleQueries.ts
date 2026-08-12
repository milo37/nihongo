import { queryOptions } from '@tanstack/react-query'
export const exampleQuery = queryOptions({
  queryKey: ['example'],
  queryFn: async () => 'ok'
})
