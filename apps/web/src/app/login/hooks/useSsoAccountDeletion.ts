import { useQuery } from '@tanstack/react-query'
import { accountQueries } from '@app/login/queries/accountQueries'
import { useAuth } from '@provider/ProtectedRouteProvider'

export const useSsoAccountDeletion = () => {
  const { isReady, user } = useAuth()
  const receipt = useQuery({
    ...accountQueries.deletion(),
    enabled: isReady && user === null
  })

  return { isReady, user, receipt }
}
