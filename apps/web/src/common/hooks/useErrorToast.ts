import { useEffect } from 'react'
import { useToast } from '@nihongo/browser/common/components/Toast'

/**
 * #1262: a failed press is said in a warning toast, not a line on the
 * screen; the button stays where it was, so no retry in the toast. Fires
 * each time the title appears (a new press clears it first).
 */
export const useErrorToast = (title: string | null, key: string): void => {
  const { addToast } = useToast()
  useEffect(() => {
    if (title) addToast({ key, title, variant: 'warning' })
  }, [title, key, addToast])
}
