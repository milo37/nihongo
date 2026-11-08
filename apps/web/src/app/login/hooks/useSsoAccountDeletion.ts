import { useQuery } from '@tanstack/react-query'
import { accountQueries } from '@app/account/queries/accountQueries'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

// Deletion receipt for the browser that just requested deletion.
export const useSsoAccountDeletion = (requested: boolean) => {
  const { isReady, user } = useAuth()
  const receipt = useQuery({
    ...accountQueries.deletion(),
    enabled: requested && isReady && user === null
  })

  return { receipt }
}
