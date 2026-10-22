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
