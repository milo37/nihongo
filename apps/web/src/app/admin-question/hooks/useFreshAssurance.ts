import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reauthenticatePhase7Admin } from '@api/phase7/phase7AdminApi'
import {
  recoverCanonicalAuthAfterAmbiguousMutation,
  refreshCanonicalAuthAfterMutation
} from '@app/login/authSession'
import { invalidatePhase7AdminMutation } from '@app/admin-question/queries/phase7AdminInvalidation'
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
  readonly reason: string
}

export const useFreshAssurance = () => {
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState<FreshAssurancePrompt | null>(null)
  const [completionMessage, setCompletionMessage] = useState<string | null>(
    null
  )
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
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
    setCompletionMessage(null)
    setRecoveryError(null)
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
    setCompletionMessage(
      '본인 확인이 완료되었습니다. 원래 작업은 자동 실행되지 않았습니다. 내용을 확인한 뒤 다시 실행해 주세요.'
    )
  }

  const recoverPrincipal = async (): Promise<void> => {
    setIsRecovering(true)
    setRecoveryError(null)
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
        setRecoveryError(
          '현재 관리자 세션을 확인했습니다. 비밀번호를 다시 입력해 본인 확인을 재시도해 주세요.'
        )
        return
      }

      setPrompt(null)
      recoveryActorId.current = null
      confirmedReauthenticationPending.current = false
    } catch (error: unknown) {
      if (isAuthTransitionSupersededError(error)) throw error
      setRecoveryRequired(true)
      setRecoveryError(
        '로그인 상태를 확인하지 못했습니다. 로컬 작업은 유지됩니다. 로그인 상태 확인을 다시 시도해 주세요.'
      )
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
    setRecoveryError(null)
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

  const errorMessage =
    recoveryError ??
    (mutation.error
      ? isApiError(mutation.error)
        ? (mutation.error.serverMessage ?? mutation.error.message)
        : '본인 확인을 완료하지 못했습니다.'
      : null)

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
