import * as phase7AdminApi from '@api/phase7/phase7AdminApi'
import * as authFence from '@libs/authTransitionFence'
import {
  updateQuestionVersionRequestSchema,
  updateQuestionVersionResponseSchema
} from '@nihongo/contracts/admin/phase7'
import { useUpdatePhase7AdminQuestionVersion } from '@app/admin-question/hooks/usePhase7AdminMutations'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolvePhase7CommandAffectedVersionIds,
  usePhase7AdminExport
} from '@app/admin-question/hooks/usePhase7AdminMutations'
import { queryClient } from '@libs/queryClient'
import { DEMO_ADMIN_ID, DEMO_REVIEWER_ADMIN_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

const useAdmin = (actorId = DEMO_ADMIN_ID): void => {
  const admin = mockDatabase.loginAs('ADMIN', actorId)
  useAppStore.getState().setCurrentUser(admin)
}

const exportQuestionIds = (): readonly string[] => {
  const question = mockDatabase
    .getCanonicalAdminCmsSnapshot()
    .questions.find((candidate) => candidate.currentPublishedVersionId !== null)
  if (!question) throw new Error('Export fixture is unavailable.')
  return [question.questionId]
}

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('Phase 7 mutation settlement fences', () => {
  it('invalidates every version changed by replacement publication or archive', () => {
    expect(
      resolvePhase7CommandAffectedVersionIds({
        command: 'PUBLISH',
        currentPublishedVersionId: 'version-current',
        openCandidateVersionId: 'version-candidate',
        resultQuestionVersionId: 'version-candidate',
        selectedVersionId: 'version-candidate'
      })
    ).toEqual(['version-candidate', 'version-current'])

    expect(
      resolvePhase7CommandAffectedVersionIds({
        command: 'ARCHIVE',
        currentPublishedVersionId: 'version-current',
        openCandidateVersionId: 'version-candidate',
        resultQuestionVersionId: null,
        selectedVersionId: 'version-unrelated-history'
      })
    ).toEqual(['version-current', 'version-candidate'])
  })

  it('discards export bytes on a same-epoch actor change during invalidation', async () => {
    useAdmin()
    const callback = vi.fn()
    let releaseInvalidation: (() => void) | undefined
    const invalidationGate = new Promise<void>((resolve) => {
      releaseInvalidation = resolve
    })
    const invalidationStarted = vi.fn()
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async () => {
      invalidationStarted()
      await invalidationGate
    })
    const { result } = renderHook(() => usePhase7AdminExport(callback), {
      wrapper
    })
    const questionIds = exportQuestionIds()

    let exportPromise!: Promise<unknown>
    act(() => {
      exportPromise = result.current.mutateAsync(questionIds)
    })
    await waitFor(() => expect(invalidationStarted).toHaveBeenCalled())

    useAdmin(DEMO_REVIEWER_ADMIN_ID)
    releaseInvalidation?.()

    await expect(exportPromise).rejects.toMatchObject({
      name: 'AuthTransitionSupersededError'
    })
    expect(callback).not.toHaveBeenCalled()
  })

  it('settles an offline admin mutation immediately without reconnect replay', async () => {
    useAdmin()
    const requests = vi.fn()
    mockServer.use(
      http.post('*/api/v1/admin/questions/export', () => {
        requests()
        return HttpResponse.error()
      })
    )
    onlineManager.setOnline(false)
    const { result } = renderHook(() => usePhase7AdminExport(), { wrapper })

    let exportPromise!: Promise<unknown>
    act(() => {
      exportPromise = result.current.mutateAsync(exportQuestionIds())
    })
    await expect(exportPromise).rejects.toBeDefined()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.isPaused).toBe(false)
    expect(requests).toHaveBeenCalledTimes(1)

    await act(async () => {
      onlineManager.setOnline(true)
      await Promise.resolve()
    })
    expect(requests).toHaveBeenCalledTimes(1)
  })
})

const updateBody = () =>
  updateQuestionVersionRequestSchema.parse({
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    difficulty: 'EASY',
    questionText: '관리자 수정 검사',
    passage: null,
    explanationKo: '정답 해설',
    explanationJa: null,
    tagNames: ['한자 읽기'],
    options: ['하나', '둘', '셋', '넷'].map((text, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      ordinal: index + 1,
      text
    })),
    correctOptionId: '00000000-0000-4000-8000-000000000001',
    expectedRowVersion: 3
  })
const mutationResult = () =>
  updateQuestionVersionResponseSchema.parse({
    questionId: '00000000-0000-4000-8000-000000000011',
    questionVersionId: '00000000-0000-4000-8000-000000000012',
    lifecycleStatus: 'ACTIVE',
    versionStatus: 'DRAFT',
    questionRowVersion: 1,
    versionRowVersion: 4,
    occurredAt: '2026-10-01T00:00:00.000Z'
  })
it('rejects a queued edit after the initiating ADMIN changes before endpoint dispatch', async () => {
  useAdmin()
  const capture = authFence.captureAuthActorTransitionFence
  vi.spyOn(authFence, 'captureAuthActorTransitionFence').mockImplementation(
    (actor) => {
      const fence = capture(actor)
      queueMicrotask(() => useAdmin(DEMO_REVIEWER_ADMIN_ID))
      return fence
    }
  )
  const update = vi
    .spyOn(phase7AdminApi, 'updatePhase7QuestionVersion')
    .mockResolvedValue(mutationResult())
  const { result } = renderHook(
    () =>
      useUpdatePhase7AdminQuestionVersion(
        mutationResult().questionId,
        mutationResult().questionVersionId!
      ),
    { wrapper }
  )
  await act(async () => {
    await expect(
      result.current.mutateAsync(updateBody())
    ).rejects.toBeInstanceOf(authFence.AuthTransitionSupersededError)
  })
  expect(update).not.toHaveBeenCalled()
})
it('ignores a late edit settlement after the ADMIN changes without invalidating caches or announcing success', async () => {
  useAdmin()
  let finish: ((value: ReturnType<typeof mutationResult>) => void) | undefined
  vi.spyOn(phase7AdminApi, 'updatePhase7QuestionVersion').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const success = vi.fn()
  const { result } = renderHook(
    () =>
      useUpdatePhase7AdminQuestionVersion(
        mutationResult().questionId,
        mutationResult().questionVersionId!,
        success
      ),
    { wrapper }
  )
  let pending: Promise<unknown> | undefined
  await act(async () => {
    pending = result.current
      .mutateAsync(updateBody())
      .catch((error: unknown) => error)
  })
  useAdmin(DEMO_REVIEWER_ADMIN_ID)
  await act(async () => {
    finish?.(mutationResult())
    await pending
  })
  expect(invalidate).not.toHaveBeenCalled()
  expect(success).not.toHaveBeenCalled()
})
