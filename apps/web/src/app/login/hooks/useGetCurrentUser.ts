import { useQuery } from '@tanstack/react-query'
import { authQueries } from '@app/login/queries/authQueries'

export const useGetCurrentUser = () => {
  return useQuery(authQueries.currentUser())
}
