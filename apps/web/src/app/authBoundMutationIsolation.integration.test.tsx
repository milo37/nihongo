import {
  MutationCache,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import { commitCanonicalAuth } from '@app/login/authSession'
import { useReviewWrongNote } from '@app/wrong-note/hooks/useReviewWrongNote'
import { useUpdateWrongNoteMemo } from '@app/wrong-note/hooks/useUpdateWrongNoteMemo'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { demoUsers } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { getContractQuestionId } from '@mocks/adapters/questionContractAdapter'
import { AuthTransitionSupersededError } from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

interface SuccessCallbackGate {
  client: QueryClient
  getSuccessCount: () => number
  release: () => void
}

const createSuccessCallbackGate = (): SuccessCallbackGate => {
  let releaseGate: (() => void) | undefined
  let successCount = 0
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve
  })

  return {
    client: new QueryClient({
      mutationCache: new MutationCache({
        onSuccess: async () => {
          successCount += 1
          if (successCount === 1) {
            await gate
          }
        }
      }),
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    }),
    getSuccessCount: () => successCount,
    release: () => releaseGate?.()
  }
}

const createWrapper =
  (client: QueryClient): ((props: { children: ReactNode }) => ReactElement) =>
  ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

const transitionToAdmin = async (client: QueryClient): Promise<void> => {
  const currentUser = mockDatabase.getCurrentUser()
  const nextUser = demoUsers.find(({ role }) => role === 'ADMIN')
  expect(currentUser).not.toBeNull()
  expect(nextUser).toBeDefined()
  if (!currentUser || !nextUser) {
    return
  }

  useAppStore.getState().setCurrentUser(currentUser)
  await commitCanonicalAuth(client, nextUser, {
    forceClear: true,
    forcePracticeReset: true
  })
}

const createWrongNoteQuestionId = (): string => {
  mockDatabase.loginAs('USER')
  const session = mockDatabase.createStudySession({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1
  })
  const question = mockDatabase.getAdminQuestion(session.questions[0].id)
  const incorrectOption = question.options.find((option) => !option.isCorrect)

  if (!incorrectOption) {
    throw new Error('오답 노트 테스트용 오답 보기가 없습니다.')
  }

  mockDatabase.submitStudySession({
    sessionId: session.session.id,
    answers: [
      {
        questionId: question.id,
        selectedOptionId: incorrectOption.id,
        elapsedSec: 2
      }
    ],
    durationSec: 2
  })
  return question.id
}

describe('auth-bound mutation callback isolation', () => {
  it('does not let an overlapping same-key delete overwrite the older action fence', async () => {
    mockDatabase.loginAs('USER')
    const questionId = getContractQuestionId('n5-vocabulary-01')
    mockServer.use(
      http.delete(
        '*/api/v1/bookmarks/:questionId',
        () =>
          new HttpResponse(null, {
            status: 204,
            headers: {
              'Cache-Control': 'private, no-store',
              'X-Request-Id': crypto.randomUUID()
            }
          })
      )
    )
    const gate = createSuccessCallbackGate()
    const wrapper = createWrapper(gate.client)
    const older = renderHook(() => useDeleteBookmark(), { wrapper })
    const newer = renderHook(() => useDeleteBookmark(), { wrapper })
    const olderSuccess = vi.fn()
    const newerSuccess = vi.fn()
    let olderPromise: Promise<unknown> | undefined

    act(() => {
      olderPromise = older.result.current.mutateAsync(questionId, {
        onSuccess: olderSuccess
      })
    })
    await waitFor(() => expect(gate.getSuccessCount()).toBe(1))
    await transitionToAdmin(gate.client)

    await act(async () => {
      await newer.result.current.mutateAsync(questionId, {
        onSuccess: newerSuccess
      })
    })
    expect(newerSuccess).toHaveBeenCalledTimes(1)

    gate.release()
    await expect(olderPromise).resolves.toMatchObject({ status: 204 })
    expect(olderSuccess).not.toHaveBeenCalled()
  })

  it('does not invalidate the next identity bookmark cache after delayed create success', async () => {
    mockDatabase.loginAs('USER')
    const gate = createSuccessCallbackGate()
    const wrapper = createWrapper(gate.client)
    const hook = renderHook(() => useCreateBookmark(), { wrapper })
    const success = vi.fn()
    const nextIdentityKey = [
      ...bookmarkQueries.allKey(),
      'next-identity'
    ] as const
    let mutationPromise: Promise<unknown> | undefined

    act(() => {
      mutationPromise = hook.result.current.mutateAsync(
        { questionId: getContractQuestionId('n5-vocabulary-01') },
        { onSuccess: success }
      )
    })
    await waitFor(() => expect(gate.getSuccessCount()).toBe(1))
    await transitionToAdmin(gate.client)
    gate.client.setQueryData(nextIdentityKey, { owner: 'next' })
    gate.release()

    await expect(mutationPromise).rejects.toBeInstanceOf(
      AuthTransitionSupersededError
    )
    expect(success).not.toHaveBeenCalled()
    expect(gate.client.getQueryData(nextIdentityKey)).toEqual({ owner: 'next' })
    expect(gate.client.getQueryState(nextIdentityKey)?.isInvalidated).toBe(
      false
    )
  })

  it('does not write the next identity wrong-note cache after delayed memo success', async () => {
    const questionId = createWrongNoteQuestionId()
    const gate = createSuccessCallbackGate()
    const wrapper = createWrapper(gate.client)
    const hook = renderHook(() => useUpdateWrongNoteMemo(questionId), {
      wrapper
    })
    const success = vi.fn()
    const detailKey = wrongNoteQueries.detail(questionId).queryKey
    let mutationPromise: Promise<unknown> | undefined

    act(() => {
      mutationPromise = hook.result.current.mutateAsync(
        { memo: '이전 사용자 메모' },
        { onSuccess: success }
      )
    })
    await waitFor(() => expect(gate.getSuccessCount()).toBe(1))
    await transitionToAdmin(gate.client)
    gate.client.setQueryData<unknown>(detailKey, { owner: 'next' })
    gate.release()

    await expect(mutationPromise).rejects.toBeInstanceOf(
      AuthTransitionSupersededError
    )
    expect(success).not.toHaveBeenCalled()
    expect(gate.client.getQueryData(detailKey)).toEqual({ owner: 'next' })
    expect(gate.client.getQueryState(detailKey)?.isInvalidated).toBe(false)
  })

  it('does not invalidate next identity caches after delayed review success', async () => {
    const questionId = createWrongNoteQuestionId()
    const gate = createSuccessCallbackGate()
    const wrapper = createWrapper(gate.client)
    const hook = renderHook(() => useReviewWrongNote(questionId), { wrapper })
    const success = vi.fn()
    const wrongNoteKey = [
      ...wrongNoteQueries.allKey(),
      'next-identity'
    ] as const
    const dashboardKey = [
      ...dashboardQueries.allKey(),
      'next-identity'
    ] as const
    let mutationPromise: Promise<unknown> | undefined

    act(() => {
      mutationPromise = hook.result.current.mutateAsync(
        { isCorrect: true },
        { onSuccess: success }
      )
    })
    await waitFor(() => expect(gate.getSuccessCount()).toBe(1))
    await transitionToAdmin(gate.client)
    gate.client.setQueryData(wrongNoteKey, { owner: 'next' })
    gate.client.setQueryData(dashboardKey, { owner: 'next' })
    gate.release()

    await expect(mutationPromise).rejects.toBeInstanceOf(
      AuthTransitionSupersededError
    )
    expect(success).not.toHaveBeenCalled()
    expect(gate.client.getQueryState(wrongNoteKey)?.isInvalidated).toBe(false)
    expect(gate.client.getQueryState(dashboardKey)?.isInvalidated).toBe(false)
  })
})
