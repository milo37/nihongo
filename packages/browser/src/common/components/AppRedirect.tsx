import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { useAppNavigate } from '../../libs/appNavigation'

export const AppRedirect = ({ to }: { to: string }): ReactElement | null => {
  const navigate = useAppNavigate()
  useEffect(() => {
    void navigate(to, { replace: true })
  }, [navigate, to])
  return null
}
