import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@nihongo/browser/api/config'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { takeGuestCarryPending } from '@app/login/guestCarryMarker'
import { guestCarryMutations } from '@app/login/queries/guestCarryMutations'

/**
 * JLP-823 D1: right after sign-in, move the guest's last result on this
 * device into the member's record once. One toast when wrong answers moved;
 * quiet when there was nothing to move.
 */
export const useGuestResultCarry = (): void => {
  const { t, i18n } = useTranslation('auth')
  const { user, isReady } = useAuth()
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const { mutate } = useMutation(guestCarryMutations.importGuestResult())
  const userId = isReady ? user?.id : undefined
  const locale = resolveUiLocale(i18n.resolvedLanguage)

  useEffect(() => {
    if (!userId || !takeGuestCarryPending()) return
    mutate(undefined, {
      onSuccess: ({ importedSessionId, wrongAnswerCount }) => {
        if (importedSessionId === null) return
        // Lists read before the move are stale; the session stays as it is.
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== 'auth'
        })
        if (wrongAnswerCount === 0) return
        addToast({
          key: 'guest-carry',
          variant: 'success',
          title: t('guestCarry.done', {
            formattedCount: formatNumber(wrongAnswerCount, locale)
          })
        })
      },
      onError: (error) => {
        if (isApiError(error) && (error.isAuthError || error.isForbiddenError))
          return
        addToast({ key: 'guest-carry', title: t('guestCarry.failed') })
      }
    })
    // Once per signed-in user; the marker keeps it to one call per sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])
}
