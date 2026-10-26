import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authQueries } from '../queries/authQueries'
import { commitCanonicalAuth } from '../authSession'
import {
  captureAuthTransitionEpoch,
  isCurrentAuthTransitionEpoch
} from '../../../libs/authTransitionFence'

export const useAdminFreshReturn = () => {
  const client = useQueryClient()
  const [phase, setPhase] = useState<'checking' | 'checked' | 'unknown'>(
    'checking'
  )
  useEffect(() => {
    let active = true
    const epoch = captureAuthTransitionEpoch()
    void client
      .fetchQuery({ ...authQueries.currentUser(), staleTime: 0 })
      .then(async (user) => {
        if (!active) return
        if (!isCurrentAuthTransitionEpoch(epoch)) {
          setPhase('unknown')
          return
        }
        const result = await commitCanonicalAuth(client, user)
        if (active) setPhase(result.applied ? 'checked' : 'unknown')
      })
      .catch(() => {
        if (active) setPhase('unknown')
      })
    return () => {
      active = false
    }
  }, [client])
  return phase
}
