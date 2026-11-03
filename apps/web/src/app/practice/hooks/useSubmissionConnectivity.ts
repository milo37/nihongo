import { useEffect, useState } from 'react'

export type SubmissionConnectivityCode = 'offline' | 'restored'

export const useSubmissionConnectivity =
  (): SubmissionConnectivityCode | null => {
    const [message, setMessage] = useState<SubmissionConnectivityCode | null>(
      () =>
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'offline'
          : null
    )

    useEffect(() => {
      const handleOffline = (): void => {
        setMessage('offline')
      }
      const handleOnline = (): void => {
        setMessage('restored')
      }

      window.addEventListener('offline', handleOffline)
      window.addEventListener('online', handleOnline)
      return () => {
        window.removeEventListener('offline', handleOffline)
        window.removeEventListener('online', handleOnline)
      }
    }, [])

    return message
  }
