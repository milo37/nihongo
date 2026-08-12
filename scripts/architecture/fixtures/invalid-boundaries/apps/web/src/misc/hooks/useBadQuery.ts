import { useQuery } from '@tanstack/react-query'
export const useBadQuery = () =>
  useQuery({ queryKey: ['bad'], queryFn: async () => 'bad' })
