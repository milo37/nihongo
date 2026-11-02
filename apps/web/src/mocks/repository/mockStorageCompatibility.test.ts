import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAuthSynchronization } from '@nihongo/browser/app/login/hooks/useAuthSynchronization'
import {
  ADMIN_CMS_MIRROR_STORAGE_KEY,
  ADMIN_CMS_STORAGE_KEY,
  cachedStorage,
  readFreshLocalStorageItemOrThrow,
  QUESTION_REPORT_RATE_LIMIT_MIRROR_STORAGE_KEY as mirror,
  QUESTION_REPORT_RATE_LIMIT_STORAGE_KEY as oldKey
} from '@nihongo/browser/libs/storage'
import { createQuestionReport } from '@api/content-operations/contentOperationsApi'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { signInMockAccount } from '@/test/auth'
import {
  createInMemoryMockMutationLease,
  MockStorageRecoveryError,
  runWithMockBrowserMutationLease,
  writeMockStorageWithMirror
} from '@mocks/repository/mockMutationCoordinator'
import { QuestionReportRateLimitRepository } from '@mocks/repository/questionReportRateLimitRepository'
import { MockDatabase } from '@mocks/repository/mockDatabase'

const actorId = '019d0000-0000-7000-8000-000000000001'
const input = { group: 'REPORT_ACTOR', actorId } as const
const memoryStorage = () => {
  const values = new Map<string, string>()
  const writes: string[] = []
  let fail = (_key: string): boolean => false
  return {
    values,
    writes,
    failWhen: (predicate: (key: string) => boolean) => {
      fail = predicate
    },
    getItem: (key: string) => values.get(key) ?? null,
    getLatestItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key)
      if (fail(key)) return false
      values.set(key, value)
      return true
    },
    removeItem: (key: string) => {
      if (fail(key)) throw new Error('storage unavailable')
      values.delete(key)
    }
  }
}

describe('legacy storage authority and compatibility mirrors', () => {
  it('reads old-only data and a late old-tab write, retaining legacy buckets and 429', async () => {
    const storage = memoryStorage()
    storage.values.set(
      oldKey,
      JSON.stringify({
        schemaVersion: 1,
        windows: [
          [`ADMIN_EDIT:actor:${actorId}`, { count: 1, windowStartedAt: 1000 }]
        ]
      })
    )
    const lease = createInMemoryMockMutationLease()
    const newer = new QuestionReportRateLimitRepository({
      storage,
      lease,
      now: () => 1000
    })
    const secondTab = new QuestionReportRateLimitRepository({
      storage,
      lease,
      now: () => 1000
    })
    await newer.consume(input)
    expect(storage.writes.slice(-2)).toEqual([mirror, oldKey])
    expect(storage.values.get(mirror)).toBe(storage.values.get(oldKey))
    const oldState = JSON.parse(storage.values.get(oldKey)!) as {
      windows: [string, { count: number; windowStartedAt: number }][]
    }
    oldState.windows.find(
      ([key]) => key === `REPORT_ACTOR:actor:${actorId}`
    )![1].count = 4
    oldState.windows.find(
      ([key]) => key === 'REPORT_ACTOR:ip:mock-client'
    )![1].count = 4
    storage.values.set(oldKey, JSON.stringify(oldState))
    await expect(secondTab.consume(input)).resolves.toEqual({
      retryAfterSeconds: null
    })
    await expect(newer.consume(input)).resolves.toEqual({
      retryAfterSeconds: 600
    })
    expect(storage.values.get(oldKey)).toContain(`ADMIN_EDIT:actor:${actorId}`)
    expect(storage.values.get(mirror)).toBe(storage.values.get(oldKey))
  })

  it('fails closed for malformed authority even if the mirror is valid', async () => {
    const storage = memoryStorage()
    storage.values.set(oldKey, '{broken')
    storage.values.set(
      mirror,
      JSON.stringify({ schemaVersion: 1, windows: [] })
    )
    const repository = new QuestionReportRateLimitRepository({
      storage,
      lease: createInMemoryMockMutationLease(),
      now: () => 1000
    })
    await expect(repository.consume(input)).rejects.toMatchObject({
      name: 'QuestionReportRateLimitRepositoryUnavailableError'
    })
    expect(storage.writes).toEqual([])
  })

  it('restores mirror after a failed authority write', () => {
    const storage = memoryStorage()
    storage.values.set('old', 'before')
    storage.values.set('mirror', 'previous')
    storage.failWhen((key) => key === 'old')
    expect(() =>
      writeMockStorageWithMirror(storage, 'old', 'mirror', 'next')
    ).toThrow()
    expect(storage.values.get('old')).toBe('before')
    expect(storage.values.get('mirror')).toBe('previous')
  })

  it('attempts to restore both values if a storage adapter mutates before reporting failure', () => {
    const storage = memoryStorage()
    storage.values.set('old', 'before')
    storage.values.set('mirror', 'previous')
    const originalSet = storage.setItem
    let failed = false
    storage.setItem = (key, value) => {
      const result = originalSet(key, value)
      if (key === 'old' && !failed) {
        failed = true
        return false
      }
      return result
    }
    expect(() =>
      writeMockStorageWithMirror(storage, 'old', 'mirror', 'next')
    ).toThrow()
    expect(storage.values.get('old')).toBe('before')
    expect(storage.values.get('mirror')).toBe('previous')
  })

  it('ignores a mirror that could not be restored and resynchronizes on the next successful write', async () => {
    const storage = memoryStorage()
    const previous = JSON.stringify({ schemaVersion: 1, windows: [] })
    storage.values.set(oldKey, previous)
    storage.values.set(mirror, previous)
    let failing = false
    const baseSet = storage.setItem
    storage.setItem = (key, value) => {
      if (failing) return false
      const result = baseSet(key, value)
      if (key === mirror) failing = true
      return result
    }
    const repository = new QuestionReportRateLimitRepository({
      storage,
      lease: createInMemoryMockMutationLease(),
      now: () => 1000
    })
    await expect(repository.consume(input)).rejects.toMatchObject({
      name: 'QuestionReportRateLimitRepositoryUnavailableError'
    })
    expect(storage.values.get(oldKey)).toBe(previous)
    expect(storage.values.get(mirror)).not.toBe(previous)
    storage.setItem = baseSet
    await expect(repository.consume(input)).resolves.toEqual({
      retryAfterSeconds: null
    })
    expect(storage.values.get(mirror)).toBe(storage.values.get(oldKey))
  })

  it('keeps old authority when removing a newly created mirror also fails', async () => {
    const storage = memoryStorage()
    const previous = JSON.stringify({ schemaVersion: 1, windows: [] })
    storage.values.set(oldKey, previous)
    let unavailable = false
    const originalSet = storage.setItem
    storage.setItem = (key, value) => {
      if (unavailable) return false
      const written = originalSet(key, value)
      if (key === mirror) {
        unavailable = true
        storage.failWhen(() => true)
      }
      return written
    }
    const repository = new QuestionReportRateLimitRepository({
      storage,
      lease: createInMemoryMockMutationLease(),
      now: () => 1000
    })
    await expect(repository.consume(input)).rejects.toMatchObject({
      name: 'QuestionReportRateLimitRepositoryUnavailableError'
    })
    expect(storage.values.get(oldKey)).toBe(previous)
    expect(storage.values.has(mirror)).toBe(true)
    storage.failWhen(() => false)
    storage.setItem = originalSet
    await repository.consume(input)
    expect(storage.values.get(mirror)).toBe(storage.values.get(oldKey))
  })

  it('does not write old authority when the mirror write is rejected', () => {
    const storage = memoryStorage()
    storage.values.set('old', 'before')
    storage.failWhen((key) => key === 'mirror')
    expect(() =>
      writeMockStorageWithMirror(storage, 'old', 'mirror', 'next')
    ).toThrow()
    expect(storage.values.get('old')).toBe('before')
    expect(storage.writes).not.toContain('old')
  })

  it('distinguishes authority damage if an adapter mutates before failure and refuses rollback', () => {
    const storage = memoryStorage()
    storage.values.set('old', 'before')
    storage.values.set('mirror', 'previous')
    const originalSet = storage.setItem
    let authorityAttempted = false
    storage.setItem = (key, value) => {
      if (key === 'old') {
        if (!authorityAttempted) {
          authorityAttempted = true
          originalSet(key, value)
        }
        return false
      }
      return originalSet(key, value)
    }
    try {
      writeMockStorageWithMirror(storage, 'old', 'mirror', 'next')
      expect.fail('a partial authority write must never report success')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MockStorageRecoveryError)
      expect(error).toMatchObject({
        authorityRecoveryFailed: true,
        mirrorRecoveryFailed: false
      })
    }
    expect(storage.values.get('old')).toBe('next')
    expect(storage.values.get('mirror')).toBe('previous')
  })

  it('reports COMMIT_UNKNOWN when a partially written CMS authority cannot be restored', async () => {
    const storage = memoryStorage()
    const originalSet = storage.setItem
    let authorityAttempted = false
    storage.setItem = (key, value) => {
      if (key === ADMIN_CMS_STORAGE_KEY) {
        if (!authorityAttempted) {
          authorityAttempted = true
          originalSet(key, value)
        }
        return false
      }
      return originalSet(key, value)
    }
    const originalRemove = storage.removeItem
    storage.removeItem = (key) => {
      if (key === ADMIN_CMS_STORAGE_KEY && authorityAttempted) {
        throw new Error('authority recovery unavailable')
      }
      originalRemove(key)
    }
    const database = new MockDatabase({
      storage,
      mutationLease: createInMemoryMockMutationLease(),
      listenToStorage: false,
      now: () => '2026-08-09T12:00:00.000Z'
    })
    try {
      await expect(
        database.getMockContentStateForHandlers().createQuestionReport({
          actorId,
          actorRole: 'USER',
          assertAuthority: () => undefined,
          resolveEntitledQuestionId: () =>
            '019d0000-0000-7000-8000-000000000002',
          request: {
            questionVersionId: '019d0000-0000-7000-8000-000000000003',
            reason: 'OTHER',
            description: '복구 실패 분류 확인'
          }
        })
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        disposition: 'COMMIT_UNKNOWN'
      })
      expect(storage.values.has(ADMIN_CMS_STORAGE_KEY)).toBe(true)
    } finally {
      database.dispose()
    }
  })

  it('distinguishes a failed mirror removal during rollback', () => {
    const storage = memoryStorage()
    storage.values.set('old', 'before')
    storage.failWhen(
      (key) =>
        key === 'old' || (key === 'mirror' && storage.values.has('mirror'))
    )
    try {
      writeMockStorageWithMirror(storage, 'old', 'mirror', 'next')
      expect.fail('failed rollback must not report success')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MockStorageRecoveryError)
      expect(error).toMatchObject({
        authorityRecoveryFailed: false,
        mirrorRecoveryFailed: true
      })
    }
    expect(storage.values.get('old')).toBe('before')
    expect(storage.values.get('mirror')).toBe('next')
  })

  it('invalidates cached values if access to localStorage itself becomes unavailable', () => {
    const key = 'jlp681-storage-access-test'
    cachedStorage.setItem(key, 'cached-value')
    expect(cachedStorage.getItem(key)).toBe('cached-value')
    const getter = vi
      .spyOn(window, 'localStorage', 'get')
      .mockImplementation(() => {
        throw new Error('storage blocked')
      })
    try {
      expect(() => readFreshLocalStorageItemOrThrow(key)).toThrow()
      expect(cachedStorage.getItem(key)).toBeNull()
    } finally {
      getter.mockRestore()
      cachedStorage.removeItem(key)
    }
  })

  it('uses the exact legacy origin-wide exclusive lock', async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'locks')
    const request = vi.fn(
      async (
        _name: string,
        _options: unknown,
        operation: () => Promise<string>
      ) => await operation()
    )
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request }
    })
    try {
      await expect(
        runWithMockBrowserMutationLease(async () => 'ok')
      ).resolves.toBe('ok')
      expect(request).toHaveBeenCalledWith(
        'nihongo:mock-database:phase7-admin-cms:v1',
        { mode: 'exclusive' },
        expect.any(Function)
      )
    } finally {
      if (previous) Object.defineProperty(navigator, 'locks', previous)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })

  it('writes the CMS mirror before authority in the actual report flow', async () => {
    await signInMockAccount()
    const {
      data: { session }
    } = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const draft = (await getStudyDraftAnswers(session.id)).data
    const { data: result } = await submitStudySessionV2(
      session.id,
      {
        answers: draft.answers,
        durationSec: 0,
        expectedDraftRevision: draft.revision
      },
      crypto.randomUUID()
    )
    const question = result.items[0]?.question
    if (!question?.questionVersionId)
      throw new Error('Reportable question fixture required')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await createQuestionReport({
      questionVersionId: question.questionVersionId,
      reason: 'OTHER',
      description: '저장 동기화를 확인합니다.'
    })
    const writes = setItem.mock.calls
      .map(([key]) => key)
      .filter(
        (key) =>
          key === ADMIN_CMS_STORAGE_KEY || key === ADMIN_CMS_MIRROR_STORAGE_KEY
      )
    expect(writes.slice(-2)).toEqual([
      ADMIN_CMS_MIRROR_STORAGE_KEY,
      ADMIN_CMS_STORAGE_KEY
    ])
    expect(localStorage.getItem(ADMIN_CMS_MIRROR_STORAGE_KEY)).toBe(
      localStorage.getItem(ADMIN_CMS_STORAGE_KEY)
    )
    setItem.mockRestore()

    const validOld = localStorage.getItem(ADMIN_CMS_STORAGE_KEY)!
    localStorage.setItem(ADMIN_CMS_STORAGE_KEY, '{malformed')
    await expect(
      createQuestionReport({
        questionVersionId: question.questionVersionId,
        reason: 'ANSWER_ERROR',
        description: '손상된 기존 저장값을 확인합니다.'
      })
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(localStorage.getItem(ADMIN_CMS_STORAGE_KEY)).toBe('{malformed')
    localStorage.setItem(ADMIN_CMS_STORAGE_KEY, validOld)

    const oldSnapshot = JSON.parse(
      localStorage.getItem(ADMIN_CMS_STORAGE_KEY)!
    ) as { mutationRevision: number; reports: unknown[] }
    oldSnapshot.mutationRevision += 1
    localStorage.setItem(ADMIN_CMS_STORAGE_KEY, JSON.stringify(oldSnapshot))
    await createQuestionReport({
      questionVersionId: question.questionVersionId,
      reason: 'ANSWER_ERROR',
      description: '이전 탭의 쓰기를 확인합니다.'
    })
    const lateWriteResult = localStorage.getItem(ADMIN_CMS_STORAGE_KEY)
    expect(localStorage.getItem(ADMIN_CMS_MIRROR_STORAGE_KEY)).toBe(
      lateWriteResult
    )
    expect(
      (JSON.parse(lateWriteResult!) as { reports: unknown[] }).reports
    ).toHaveLength(2)

    const originalSet = Storage.prototype.setItem
    let rejectWrites = false
    const failure = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key, value) {
        if (
          rejectWrites &&
          (key === ADMIN_CMS_STORAGE_KEY ||
            key === ADMIN_CMS_MIRROR_STORAGE_KEY)
        )
          throw new Error('storage unavailable')
        originalSet.call(this, key, value)
        if (key === ADMIN_CMS_MIRROR_STORAGE_KEY) rejectWrites = true
      })
    const request = {
      questionVersionId: question.questionVersionId,
      reason: 'EXPLANATION_ERROR' as const,
      description: '복구 실패를 확인합니다.'
    }
    await expect(createQuestionReport(request)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE'
    })
    expect(localStorage.getItem(ADMIN_CMS_STORAGE_KEY)).toBe(lateWriteResult)
    expect(localStorage.getItem(ADMIN_CMS_MIRROR_STORAGE_KEY)).not.toBe(
      lateWriteResult
    )
    failure.mockRestore()
    await createQuestionReport(request)
    expect(localStorage.getItem(ADMIN_CMS_MIRROR_STORAGE_KEY)).toBe(
      localStorage.getItem(ADMIN_CMS_STORAGE_KEY)
    )
    expect(
      (
        JSON.parse(localStorage.getItem(ADMIN_CMS_STORAGE_KEY)!) as {
          reports: unknown[]
        }
      ).reports
    ).toHaveLength(3)
  })

  it('ignores mirror events while retaining legacy CMS authentication synchronization', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)
    const { result } = renderHook(() => useAuthSynchronization(), { wrapper })
    await waitFor(() => expect(result.current.isReady).toBe(true))
    invalidate.mockClear()
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: ADMIN_CMS_MIRROR_STORAGE_KEY,
          newValue: 'untrusted'
        })
      )
    )
    expect(invalidate).not.toHaveBeenCalled()
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: ADMIN_CMS_STORAGE_KEY,
          newValue: null
        })
      )
    )
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    client.clear()
  })
})
