import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '@libs/queryClient'

type ReactQueryProviderProps = {
  children: ReactNode
}

export const ReactQueryProvider = ({
  children
}: ReactQueryProviderProps): ReactNode => {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
