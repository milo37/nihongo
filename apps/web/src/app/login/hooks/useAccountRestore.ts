import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AccountFlowError } from '@app/account/accountFlowErrors'
import { formatErasureDate } from '@app/login/erasureDate'
import type { AccountRestoreOutcome } from '@app/login/hooks/useAccountRestoreNotice'
import { takeGuestCarryPending } from '@app/login/guestCarryMarker'
import {
  restoreMutations,
  restoreQueries
} from '@app/login/queries/restoreQueries'
import { refreshCanonicalAuthAfterMutation } from '@nihongo/browser/app/login/authSession'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

export type RestoreFailure = 'RESTORE_FAILED' | 'RESTORE_TOO_LATE'

const failureOf = (error: unknown): RestoreFailure =>
  error instanceof AccountFlowError &&
  error.code === 'SSO_ACCOUNT_RESTORE_TOO_LATE'
    ? 'RESTORE_TOO_LATE'
    : 'RESTORE_FAILED'

/**
 * JLP-845 flow 5: an account in its 7-day erasure grace period signed in.
 * No session yet; restore it or keep the scheduled erasure.
 */
export const useAccountRestore = (
  redirect: string,
  onFailed: (failure: RestoreFailure) => void
) => {
  const { i18n } = useTranslation('auth')
  // Lazy routes read the locale here, not from I18nProvider (one chunk).
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const navigate = useAppNavigate()
  const queryClient = useQueryClient()
  const state = useQuery(restoreQueries.state())
  const restore = useMutation(restoreMutations.restore())
  const decline = useMutation(restoreMutations.decline())
  const scheduledAt = state.data?.deletionScheduledAt ?? null

  useEffect(() => {
    if (state.isError) onFailed('RESTORE_FAILED')
  }, [onFailed, state.isError])

  const onRestore = (): void => {
    restore.mutate(undefined, {
      onSuccess: async () => {
        queryClient.removeQueries({ queryKey: restoreQueries.allKey() })
        const confirmed = await refreshCanonicalAuthAfterMutation(queryClient, {
          expectedIdentity: 'AUTHENTICATED',
          forceClear: true,
          forcePracticeReset: true
        })
        if (!confirmed.applied) {
          onFailed('RESTORE_FAILED')
          return
        }
        const accountRestore: AccountRestoreOutcome = { kind: 'restored' }
        await navigate(redirect, { replace: true, state: { accountRestore } })
      },
      onError: (error) => onFailed(failureOf(error))
    })
  }
  const onKeep = (): void => {
    if (!scheduledAt) return
    // The guest's result moves only into a restored account (D1).
    takeGuestCarryPending()
    const done = (at: string): void => {
      queryClient.removeQueries({ queryKey: restoreQueries.allKey() })
      // Formatted here so the layout's notice needs no date code.
      const accountRestore: AccountRestoreOutcome = {
        kind: 'kept',
        date: formatErasureDate(at, locale)
      }
      void navigate('/', { replace: true, state: { accountRestore } })
    }
    decline.mutate(undefined, {
      onSuccess: (response) => done(response.deletionScheduledAt),
      // Nothing changes on the server either way; the cookie just expires.
      onError: () => done(scheduledAt)
    })
  }

  return {
    isChecking: state.isPending,
    date: scheduledAt ? formatErasureDate(scheduledAt, locale) : null,
    isRestoring: restore.isPending,
    busy: restore.isPending || decline.isPending,
    onRestore,
    onKeep
  }
}
