import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'
import { AccountFlowError } from '@app/account/accountFlowErrors'
import { formatErasureDate } from '@app/login/erasureDate'
import { takeGuestCarryPending } from '@app/login/guestCarryMarker'
import {
  restoreMutations,
  restoreQueries
} from '@app/login/queries/restoreQueries'
import { refreshCanonicalAuthAfterMutation } from '@nihongo/browser/app/login/authSession'
import { Button } from '@nihongo/browser/common/components/Button'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'

export type RestoreFailure = 'RESTORE_FAILED' | 'RESTORE_TOO_LATE'

type RestoreCardProps = {
  redirect: string
  onFailed: (failure: RestoreFailure) => void
}

// The date in the description is bold ink (<date>…</date> in the text).
const boldDate = (text: string): ReactNode[] =>
  text
    .split(/(<date>.*?<\/date>)/u)
    .map((part, index) => {
      const match = /^<date>(.*)<\/date>$/u.exec(part)
      return match ? (
        <strong key={index} className="font-semibold text-ink">
          {match[1]}
        </strong>
      ) : (
        part
      )
    })

const failureOf = (error: unknown): RestoreFailure =>
  error instanceof AccountFlowError &&
  error.code === 'SSO_ACCOUNT_RESTORE_TOO_LATE'
    ? 'RESTORE_TOO_LATE'
    : 'RESTORE_FAILED'

/**
 * JLP-845 flow 5: an account in its 7-day erasure grace period signed in.
 * No session yet; restore it or keep the scheduled erasure.
 */
export const RestoreCard = ({
  redirect,
  onFailed
}: RestoreCardProps): ReactElement | null => {
  const { t } = useTranslation('auth')
  const { locale } = useUiLocale()
  const navigate = useAppNavigate()
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const heading = useRef<HTMLHeadingElement>(null)
  const state = useQuery(restoreQueries.state())
  const restore = useMutation(restoreMutations.restore())
  const decline = useMutation(restoreMutations.decline())
  const date = state.data
    ? formatErasureDate(state.data.deletionScheduledAt, locale)
    : null

  useEffect(() => {
    if (state.isError) onFailed('RESTORE_FAILED')
  }, [onFailed, state.isError])
  useEffect(() => {
    if (date) heading.current?.focus()
  }, [date])

  if (state.isPending) {
    return (
      <div className="auth-panel auth-restore">
        <p role="status">{t('sso.checkingAccount')}</p>
      </div>
    )
  }
  if (!state.data || !date) return null
  const { deletionScheduledAt } = state.data
  const busy = restore.isPending || decline.isPending

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
        addToast({ key: 'account-restore', title: t('recover.restored') })
        await navigate(redirect, { replace: true })
      },
      onError: (error) => onFailed(failureOf(error))
    })
  }
  const onKeep = (): void => {
    // The guest's result moves only into a restored account (D1).
    takeGuestCarryPending()
    const done = (scheduledAt: string): void => {
      queryClient.removeQueries({ queryKey: restoreQueries.allKey() })
      addToast({
        key: 'account-restore',
        title: t('recover.kept', {
          date: formatErasureDate(scheduledAt, locale)
        })
      })
      void navigate('/', { replace: true })
    }
    decline.mutate(undefined, {
      onSuccess: (response) => done(response.deletionScheduledAt),
      // Nothing changes on the server either way; the cookie just expires.
      onError: () => done(deletionScheduledAt)
    })
  }

  return (
    <div className="auth-panel auth-restore">
      <h1 ref={heading} className="outline-none" tabIndex={-1}>
        {t('recover.title')}
      </h1>
      <p className="auth-description">
        {boldDate(t('recover.description', { date }))}
      </p>
      <div className="auth-actions">
        <Button
          size="lg"
          fullWidth
          disabled={busy}
          isLoading={restore.isPending}
          onClick={onRestore}
        >
          {t('recover.restore')}
        </Button>
        <Button
          size="lg"
          variant="outline"
          fullWidth
          disabled={busy}
          onClick={onKeep}
        >
          {t('recover.keep')}
        </Button>
      </div>
    </div>
  )
}
