import { useQuery } from '@tanstack/react-query'
export const useExample = () =>
  useQuery({ queryKey: ['example'], queryFn: async () => 'ok' })
