import { useState } from 'react'
import { useStartReauth } from '@nihongo/browser/app/reauth/hooks/useStartReauth'

/**
 * Same-tab re-verification for an admin screen. `keep` stores what the page
 * should restore after the return; when it cannot, the page stays and
 * `storageFailed` asks the admin to keep their input another way.
 */
export const useAdminReauth = () => {
  const reauth = useStartReauth()
  const [storageFailed, setStorageFailed] = useState(false)
  const start = (keep?: () => boolean): void => {
    if (reauth.busy) return
    if (keep && !keep()) {
      setStorageFailed(true)
      return
    }
    setStorageFailed(false)
    reauth.start()
  }
  return { start, busy: reauth.busy, error: reauth.error, storageFailed }
}

export type AdminReauth = ReturnType<typeof useAdminReauth>
