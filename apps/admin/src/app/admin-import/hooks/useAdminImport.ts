import { useSyncExternalStore } from 'react'
import {
  onlineManager,
  useMutation,
  useQueryClient
} from '@tanstack/react-query'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence,
  type AuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'
import { adminImportMutations } from '@app/admin-import/queries/adminImportQueries'
const fences = new WeakMap<object, AuthActorTransitionFence>()
const assertOnline = (): void => {
  if (!onlineManager.isOnline())
    throw Object.assign(new Error('Offline import refused'), {
      isOffline: true
    })
}
const assertAdmin = (fence: AuthActorTransitionFence | undefined): void => {
  if (!fence || fence.role !== 'ADMIN')
    throw new AuthTransitionSupersededError()
  assertCurrentAuthActorTransitionFence(
    fence,
    useAppStore.getState().currentUser
  )
}
const bind = (body: object): AuthActorTransitionFence => {
  assertOnline()
  const actor = useAppStore.getState().currentUser
  if (actor?.role !== 'ADMIN') throw new AuthTransitionSupersededError()
  const fence = captureAuthActorTransitionFence(actor)
  fences.set(body, fence)
  return fence
}
export const useValidateImport = () => {
  const options = adminImportMutations.validate()
  return useMutation({
    ...options,
    retry: false,
    networkMode: 'always',
    scope: { id: 'admin-import-operation' },
    onMutate: bind,
    mutationFn: (body, context) => {
      assertAdmin(fences.get(body))
      assertOnline()
      return options.mutationFn!(body, context)
    },
    onSuccess: (_result, _body, fence) => assertAdmin(fence)
  })
}
export const useApplyImport = () => {
  const client = useQueryClient()
  const options = adminImportMutations.apply()
  return useMutation({
    ...options,
    retry: false,
    networkMode: 'always',
    scope: { id: 'admin-import-operation' },
    onMutate: bind,
    mutationFn: (body, context) => {
      assertAdmin(fences.get(body))
      assertOnline()
      return options.mutationFn!(body, context)
    },
    onSuccess: async (_result, _body, fence) => {
      assertAdmin(fence)
      await Promise.all(
        [
          adminQuestionQueries.allKey(),
          serverStateQueryKeys.adminQuestion.all(),
          adminAuditQueries.allKey()
        ].map((queryKey) => client.invalidateQueries({ queryKey }))
      )
      assertAdmin(fence)
    }
  })
}

export const useImportOnline = (): boolean =>
  useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline()
  )
