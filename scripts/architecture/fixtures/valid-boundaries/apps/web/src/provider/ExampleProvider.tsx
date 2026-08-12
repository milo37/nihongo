import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
const client = new QueryClient()
export const ExampleProvider = () => (
  <QueryClientProvider client={client}>
    <span>ok</span>
  </QueryClientProvider>
)
