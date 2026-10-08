import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reauthenticatePhase7Admin } from '@api/phase7/phase7AdminApi'
import {
  recoverCanonicalAuthAfterAmbiguousMutation,
  refreshCanonicalAuthAfterMutation
} from '@app/login/authSession'
import { invalidatePhase7AdminMutation } from '@app/admin-question/queries/phase7AdminInvalidation'
import {
  getAdminApiErrorKey,
  type FreshAssuranceReasonCode
} from '@app/admin/presentation/adminPresentation'
import { isApiError } from '@api/config'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthTransitionEpoch,
  captureAuthTransitionEpoch,
  isAuthTransitionSupersededError
} from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'

export interface FreshAssurancePrompt {
  readonly questionIds?: readonly string[]
  readonly reportId?: string
  readonly reasonCode: FreshAssuranceReasonCode
}

export const useFreshAssurance = () => {
  const { t } = useTranslation('admin')
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState<FreshAssurancePrompt | null>(null)
  const [completionStatus, setCompletionStatus] = useState<'COMPLETE' | null>(
    null
  )
  const [recoveryStatus, setRecoveryStatus] = useState<
    'FAILED' | 'RECOVERED' | null
  >(null)
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [isRecovering, setIsRecovering] = useState(false)
  const recoveryActorId = useRef<string | null>(null)
  const confirmedReauthenticationPending = useRef(false)
  const mutation = useMutation({
    mutationKey: ['phase7-admin', 'reauthentication'],
    networkMode: 'always',
    mutationFn: reauthenticatePhase7Admin
  })

  const open = (nextPrompt: FreshAssurancePrompt): void => {
    mutation.reset()
    setCompletionStatus(null)
    setRecoveryStatus(null)
    setRecoveryRequired(false)
    recoveryActorId.current = null
    confirmedReauthenticationPending.current = false
    setPrompt(nextPrompt)
  }

  const close = (): void => {
    if (!mutation.isPending && !isRecovering) {
      confirmedReauthenticationPending.current = false
      setPrompt(null)
    }
  }

  const settleConfirmedReauthentication = async (
    activePrompt: FreshAssurancePrompt,
    actorId: string
  ): Promise<void> => {
    const settlementEpoch = captureAuthTransitionEpoch()
    await invalidatePhase7AdminMutation(queryClient, {
      kind: 'REAUTHENTICATION',
      questionIds: activePrompt.questionIds,
      reportId: activePrompt.reportId
    })
    assertCurrentAuthTransitionEpoch(settlementEpoch)
    const settledActor = useAppStore.getState().currentUser
    if (settledActor?.id !== actorId || settledActor.role !== 'ADMIN') {
      throw new AuthTransitionSupersededError()
    }

    confirmedReauthenticationPending.current = false
    setPrompt(null)
    recoveryActorId.current = null
    setCompletionStatus('COMPLETE')
  }

  const recoverPrincipal = async (): Promise<void> => {
    setIsRecovering(true)
    setRecoveryStatus(null)
    try {
      const recovery =
        await recoverCanonicalAuthAfterAmbiguousMutation(queryClient)
      if (!recovery.applied) throw new AuthTransitionSupersededError()

      setRecoveryRequired(false)
      mutation.reset()
      if (
        recovery.user?.role === 'ADMIN' &&
        recovery.user.id === recoveryActorId.current
      ) {
        if (confirmedReauthenticationPending.current) {
          const activePrompt = prompt
          if (!activePrompt) throw new AuthTransitionSupersededError()
          await settleConfirmedReauthentication(activePrompt, recovery.user.id)
          return
        }
        setRecoveryStatus('RECOVERED')
        return
      }

      setPrompt(null)
      recoveryActorId.current = null
      confirmedReauthenticationPending.current = false
    } catch (error: unknown) {
      if (isAuthTransitionSupersededError(error)) throw error
      setRecoveryRequired(true)
      setRecoveryStatus('FAILED')
      throw error
    } finally {
      setIsRecovering(false)
    }
  }

  const reauthenticate = async (password: string): Promise<void> => {
    const activePrompt = prompt
    if (!activePrompt) return
    const initialActor = useAppStore.getState().currentUser
    if (!initialActor || initialActor.role !== 'ADMIN') {
      throw new AuthTransitionSupersededError()
    }
    recoveryActorId.current = initialActor.id
    setRecoveryStatus(null)
    setRecoveryRequired(false)

    try {
      await mutation.mutateAsync({ password })
      confirmedReauthenticationPending.current = true
      const refresh = await refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'AUTHENTICATED'
      })
      const currentActor = useAppStore.getState().currentUser
      if (
        !refresh.applied ||
        currentActor?.id !== initialActor.id ||
        currentActor.role !== 'ADMIN'
      ) {
        throw new AuthTransitionSupersededError()
      }

      await settleConfirmedReauthentication(activePrompt, initialActor.id)
    } catch (error: unknown) {
      if (isAuthTransitionSupersededError(error)) {
        confirmedReauthenticationPending.current = false
        throw error
      }
      if (
        confirmedReauthenticationPending.current ||
        (isApiError(error) && (error.status === 500 || error.status === 503))
      ) {
        try {
          await recoverPrincipal()
        } catch {
          // recoverPrincipal owns the retryable recovery state.
        }
      }
      throw error
    }
  }

  const completionMessage =
    completionStatus === 'COMPLETE' ? t('freshAssurance.complete') : null
  const errorMessage = recoveryStatus
    ? t(
        recoveryStatus === 'RECOVERED'
          ? 'freshAssurance.recovered'
          : 'freshAssurance.recoveryFailed'
      )
    : mutation.error
      ? isApiError(mutation.error)
        ? t(getAdminApiErrorKey(mutation.error))
        : t('freshAssurance.failed')
      : null

  return {
    close,
    completionMessage,
    errorMessage,
    isOpen: prompt !== null,
    isPending: mutation.isPending || isRecovering,
    isRecovering,
    open,
    prompt,
    recoveryRequired,
    reauthenticate,
    retryRecovery: recoverPrincipal
  }
}

export type FreshAssuranceController = ReturnType<typeof useFreshAssurance>
