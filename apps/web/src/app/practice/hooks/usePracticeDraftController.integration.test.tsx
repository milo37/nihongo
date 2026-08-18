import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import {
  saveStudyDraftAnswersBodySchema,
  type SaveStudyDraftAnswersBody
} from '@nihongo/contracts/study/save-study-draft-answers'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelStudySession } from '@api/study/cancelStudySession'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import {
  applySaveStudyDraftBody,
  diffStudyDraftSnapshots,
  mergeStudyDraftSnapshots
} from '@app/practice/draft/studyDraftMerge'
import {
  createFrozenStudyDraftAttempt,
  createStudyDraftWorkingCopy
} from '@app/practice/draft/studyDraftWorkingCopy'
import {
  clearStudyDraftWorkingCopyMemoryCache,
  readStudyDraftWorkingCopy,
  writeStudyDraftWorkingCopy
} from '@app/practice/draft/studyDraftWorkingCopyStorage'
import {
  STUDY_DRAFT_AUTOSAVE_DELAY_MS,
  usePracticeDraftController
} from '@app/practice/hooks/usePracticeDraftController'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { subscribeApiError } from '@libs/errorBus'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const sessionId = '00000000-0000-4000-8000-000000000101'
const questionIds = [
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000104'
] as const
const optionIds = [
  '00000000-0000-4000-8000-000000000105',
  '00000000-0000-4000-8000-000000000106',
  '00000000-0000-4000-8000-000000000107'
] as const
const draftUrl = `*/api/v1/study-sessions/${sessionId}/draft-answers`

const jsonHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Nihongo-Practice-Contract': '2'
}

const createSnapshot = (
  revision = 0,
  overrides: Partial<StudyDraftSnapshot> = {}
): StudyDraftSnapshot => ({
  answers: questionIds.map((studySessionQuestionId) => ({
    elapsedSec: 0,
    selectedOptionId: null,
    studySessionQuestionId
  })),
  currentOrdinal: 1,
  revision,
  savedAt: revision === 0 ? null : `2026-08-18T00:00:0${revision}.000Z`,
  studySessionId: sessionId,
  ...overrides
})

const toAcknowledgement = (
  base: StudyDraftSnapshot,
  body: SaveStudyDraftAnswersBody,
  revision: number
): StudyDraftSnapshot => ({
  ...applySaveStudyDraftBody(base, body),
  revision,
  savedAt: `2026-08-18T00:00:0${revision}.000Z`
})

const createDeferred = (): {
  promise: Promise<void>
  resolve: () => void
} => {
  let resolve = (): void => undefined
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

const createWrapper =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('practice draft controller integration', () => {
  it('debounces for 750ms, keeps one request in flight, and drains post-flight edits', async () => {
    const user = mockDatabase.loginAs('USER')
    let serverSnapshot = createSnapshot()
    const firstResponse = createDeferred()
    const requests: Array<{
      body: SaveStudyDraftAnswersBody
      key: string | null
    }> = []
    let concurrent = 0
    let maxConcurrent = 0

    mockServer.use(
      http.get(draftUrl, () =>
        HttpResponse.json(serverSnapshot, { headers: jsonHeaders })
      ),
      http.put(draftUrl, async ({ request }) => {
        const body = saveStudyDraftAnswersBodySchema.parse(await request.json())
        requests.push({
          body,
          key: request.headers.get('Idempotency-Key')
        })
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        if (requests.length === 1) {
          await firstResponse.promise
        }
        serverSnapshot = toAcknowledgement(
          serverSnapshot,
          body,
          serverSnapshot.revision + 1
        )
        concurrent -= 1
        return HttpResponse.json(serverSnapshot, { headers: jsonHeaders })
      })
    )

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: questionIds,
          isInteractionPaused: false,
          sessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))

    vi.useFakeTimers()
    act(() => {
      hook.result.current.selectOption(questionIds[0], optionIds[0])
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUDY_DRAFT_AUTOSAVE_DELAY_MS - 1)
    })
    expect(requests).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    vi.useRealTimers()

    act(() => {
      hook.result.current.selectOption(questionIds[1], optionIds[1])
      hook.result.current.moveToOrdinal(2)
    })
    let flushPromise: Promise<StudyDraftSnapshot>
    act(() => {
      flushPromise = hook.result.current.flush()
    })
    expect(requests).toHaveLength(1)
    expect(
      useAppStore.getState().draftWorkingCopy?.postFlightLocalDiff
    ).not.toEqual({ answers: {} })

    await act(async () => {
      firstResponse.resolve()
      await flushPromise
    })

    expect(requests).toHaveLength(2)
    expect(maxConcurrent).toBe(1)
    expect(requests[0]?.body.expectedRevision).toBe(0)
    expect(requests[0]?.body.answers[0]?.selectedOptionId).toBe(optionIds[0])
    expect(requests[0]?.body.answers[1]?.selectedOptionId).toBeNull()
    expect(requests[1]?.body.expectedRevision).toBe(1)
    expect(requests[1]?.body.answers[1]?.selectedOptionId).toBe(optionIds[1])
    expect(requests[1]?.key).not.toBe(requests[0]?.key)
    expect(useAppStore.getState().draftWorkingCopy).toMatchObject({
      frozenAttempt: null,
      localDiff: { answers: {} },
      postFlightLocalDiff: { answers: {} }
    })
    client.clear()
  })

  it('replays a frozen request before GET, rebases a newer canonical draft, and uses a new key', async () => {
    const user = mockDatabase.loginAs('USER')
    const principalScope = `USER:${user.id}`
    const base = createSnapshot()
    const firstBody = {
      answers: base.answers.map((answer, index) =>
        index === 0 ? { ...answer, selectedOptionId: optionIds[0] } : answer
      ),
      currentOrdinal: 1,
      expectedRevision: 0
    }
    const firstKey = '00000000-0000-4000-8000-000000000108'
    const acknowledgement = toAcknowledgement(base, firstBody, 1)
    const remoteRevisionTwo = createSnapshot(2, {
      answers: acknowledgement.answers.map((answer, index) =>
        index === 1 ? { ...answer, selectedOptionId: optionIds[1] } : answer
      ),
      savedAt: '2026-08-18T00:00:02.000Z'
    })
    const localAfterResponseLoss = {
      ...acknowledgement,
      answers: acknowledgement.answers.map((answer, index) =>
        index === 2 ? { ...answer, selectedOptionId: optionIds[2] } : answer
      ),
      currentOrdinal: 3
    }
    const stored = createStudyDraftWorkingCopy({
      confirmedBase: base,
      principalScope,
      sessionId
    })
    stored.frozenAttempt = createFrozenStudyDraftAttempt({
      body: firstBody,
      idempotencyKey: firstKey,
      sessionId
    })
    stored.postFlightLocalDiff = diffStudyDraftSnapshots(
      acknowledgement,
      localAfterResponseLoss
    )
    writeStudyDraftWorkingCopy(stored)
    clearStudyDraftWorkingCopyMemoryCache()
    useAppStore.getState().setDraftWorkingCopy(null)

    let serverSnapshot = remoteRevisionTwo
    const wireOrder: string[] = []
    const requests: Array<{
      body: SaveStudyDraftAnswersBody
      key: string | null
    }> = []
    mockServer.use(
      http.get(draftUrl, () => {
        wireOrder.push('GET')
        return HttpResponse.json(serverSnapshot, { headers: jsonHeaders })
      }),
      http.put(draftUrl, async ({ request }) => {
        wireOrder.push('PUT')
        const body = saveStudyDraftAnswersBodySchema.parse(await request.json())
        const key = request.headers.get('Idempotency-Key')
        requests.push({ body, key })
        if (requests.length === 1) {
          return HttpResponse.json(acknowledgement, {
            headers: { ...jsonHeaders, 'Idempotency-Replayed': 'true' }
          })
        }
        serverSnapshot = toAcknowledgement(serverSnapshot, body, 3)
        return HttpResponse.json(serverSnapshot, { headers: jsonHeaders })
      })
    )

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: questionIds,
          isInteractionPaused: false,
          sessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(wireOrder[0]).toBe('PUT')
    expect(requests[0]).toEqual({ body: firstBody, key: firstKey })
    await waitFor(() =>
      expect(useAppStore.getState().draftSaveState).toBe('dirty')
    )

    await act(async () => {
      await hook.result.current.flush()
    })

    expect(wireOrder.slice(0, 4)).toEqual(['PUT', 'GET', 'PUT', 'GET'])
    expect(requests).toHaveLength(2)
    expect(requests[1]?.key).not.toBe(firstKey)
    expect(requests[1]?.body.expectedRevision).toBe(2)
    expect(
      requests[1]?.body.answers.map(({ selectedOptionId }) => selectedOptionId)
    ).toEqual(optionIds)
    expect(serverSnapshot.revision).toBe(3)
    expect(
      serverSnapshot.answers.map(({ selectedOptionId }) => selectedOptionId)
    ).toEqual(optionIds)
    client.clear()
  })

  it('settles a save against an externally cancelled session and clears scoped work', async () => {
    const user = mockDatabase.loginAs('USER')
    const created = await createStudySessionV2({
      count: 2,
      level: 'N5',
      mode: 'RANDOM',
      subject: 'VOCABULARY'
    })
    const createdSessionId = created.data.session.id
    const firstQuestion = created.data.questions[0]
    const firstOption = firstQuestion?.question.options[0]
    if (!firstQuestion || !firstOption) {
      throw new Error('terminal convergence fixture가 필요합니다.')
    }

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: created.data.questions.map(
            (question) => question.sessionQuestionId
          ),
          isInteractionPaused: false,
          sessionId: createdSessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))
    await cancelStudySession(createdSessionId)

    act(() => {
      hook.result.current.selectOption(
        firstQuestion.sessionQuestionId,
        firstOption.id
      )
    })
    await act(async () => {
      await expect(hook.result.current.flush()).rejects.toMatchObject({
        code: 'STUDY_SESSION_NOT_EDITABLE'
      })
    })

    await waitFor(() =>
      expect(useAppStore.getState().draftWorkingCopy).toBeNull()
    )
    expect(
      client.getQueryData(serverStateQueryKeys.study.session(createdSessionId))
    ).toMatchObject({ session: { status: 'CANCELLED' } })
    clearStudyDraftWorkingCopyMemoryCache()
    expect(
      readStudyDraftWorkingCopy(`USER:${user.id}`, createdSessionId)
    ).toBeNull()
    client.clear()
  })

  it('restores an unresolved conflict after reload and never autosaves it', async () => {
    const user = mockDatabase.loginAs('USER')
    const principalScope = `USER:${user.id}`
    const base = createSnapshot()
    const local = {
      ...base,
      answers: base.answers.map((answer, index) =>
        index === 0 ? { ...answer, selectedOptionId: optionIds[0] } : answer
      )
    }
    const remote = createSnapshot(1, {
      answers: base.answers.map((answer, index) =>
        index === 0 ? { ...answer, selectedOptionId: optionIds[1] } : answer
      )
    })
    const merged = mergeStudyDraftSnapshots(base, local, remote)
    const stored = createStudyDraftWorkingCopy({
      confirmedBase: remote,
      principalScope,
      sessionId
    })
    stored.localDiff = diffStudyDraftSnapshots(remote, merged.localPreferred)
    stored.pendingConflict = {
      base,
      conflicts: merged.conflicts,
      local,
      localPreferred: merged.localPreferred,
      remote
    }
    writeStudyDraftWorkingCopy(stored)
    clearStudyDraftWorkingCopyMemoryCache()
    useAppStore.getState().setDraftWorkingCopy(null)

    let putCount = 0
    mockServer.use(
      http.get(draftUrl, () =>
        HttpResponse.json(remote, { headers: jsonHeaders })
      ),
      http.put(draftUrl, () => {
        putCount += 1
        return HttpResponse.json(remote, { headers: jsonHeaders })
      })
    )
    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: questionIds,
          isInteractionPaused: false,
          sessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => {
      expect(hook.result.current.saveState).toBe('conflict')
      expect(hook.result.current.conflictCount).toBe(1)
    })

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(putCount).toBe(0)
    expect(
      useAppStore.getState().draftWorkingCopy?.pendingConflict
    ).not.toBeNull()
    expect(hook.result.current.snapshot).toEqual(merged.localPreferred)
    client.clear()
  })

  it('keeps the frozen request when a same-revision canonical snapshot changes content', async () => {
    const user = mockDatabase.loginAs('USER')
    const base = createSnapshot()
    let getCount = 0
    let putCount = 0
    mockServer.use(
      http.get(draftUrl, () => {
        getCount += 1
        if (getCount === 1) {
          return HttpResponse.json(base, { headers: jsonHeaders })
        }
        return HttpResponse.json(
          createSnapshot(1, {
            answers: base.answers.map((answer, index) =>
              index === 1
                ? { ...answer, selectedOptionId: optionIds[1] }
                : answer
            )
          }),
          { headers: jsonHeaders }
        )
      }),
      http.put(draftUrl, async ({ request }) => {
        putCount += 1
        const body = saveStudyDraftAnswersBodySchema.parse(await request.json())
        return HttpResponse.json(toAcknowledgement(base, body, 1), {
          headers: jsonHeaders
        })
      })
    )

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: questionIds,
          isInteractionPaused: false,
          sessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))

    act(() => {
      hook.result.current.selectOption(questionIds[0], optionIds[0])
    })
    await act(async () => {
      await expect(hook.result.current.flush()).rejects.toThrow(
        'canonical draft의 revision 또는 내용이 일치하지 않습니다.'
      )
    })

    expect(putCount).toBe(1)
    expect(useAppStore.getState().draftSaveState).toBe('error')
    expect(
      useAppStore.getState().draftWorkingCopy?.frozenAttempt
    ).not.toBeNull()
    expect(hook.result.current.snapshot?.answers[0]?.selectedOptionId).toBe(
      optionIds[0]
    )
    expect(
      client.getQueryData(serverStateQueryKeys.study.draft(sessionId))
    ).toEqual(base)
    client.clear()
  })

  it('does not rotate the frozen key when a conflict GET is stale', async () => {
    const user = mockDatabase.loginAs('USER')
    const base = createSnapshot()
    let getCount = 0
    let putCount = 0
    mockServer.use(
      http.get(draftUrl, () => {
        getCount += 1
        return HttpResponse.json(base, { headers: jsonHeaders })
      }),
      http.put(draftUrl, () => {
        putCount += 1
        return HttpResponse.json(
          {
            code: 'DRAFT_VERSION_CONFLICT',
            message: '다른 요청이 작업본을 먼저 저장했습니다.',
            requestId: '00000000-0000-4000-8000-000000000109',
            retryable: false
          },
          { status: 409 }
        )
      })
    )

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: questionIds,
          isInteractionPaused: false,
          sessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))

    act(() => {
      hook.result.current.selectOption(questionIds[0], optionIds[0])
    })
    await act(async () => {
      await expect(hook.result.current.flush()).rejects.toThrow(
        '충돌 뒤 canonical draft revision이 앞으로 이동하지 않았습니다.'
      )
    })

    const frozenKey =
      useAppStore.getState().draftWorkingCopy?.frozenAttempt?.idempotencyKey
    expect(frozenKey).toBeTruthy()
    expect(putCount).toBe(1)
    expect(getCount).toBe(2)
    expect(useAppStore.getState().draftSaveState).toBe('error')

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(putCount).toBe(1)
    expect(
      useAppStore.getState().draftWorkingCopy?.frozenAttempt?.idempotencyKey
    ).toBe(frozenKey)
    client.clear()
  })

  it('keeps an integrity block after a transient retry failure and never overwrites the server', async () => {
    const user = mockDatabase.loginAs('USER')
    const base = createSnapshot()
    const changedAtSameRevision = createSnapshot(0, {
      answers: base.answers.map((answer, index) =>
        index === 1 ? { ...answer, selectedOptionId: optionIds[1] } : answer
      )
    })
    let getCount = 0
    let putCount = 0

    mockServer.use(
      http.get(draftUrl, () => {
        getCount += 1
        if (getCount === 1) {
          return HttpResponse.json(base, { headers: jsonHeaders })
        }
        if (getCount === 2) {
          return HttpResponse.json(changedAtSameRevision, {
            headers: jsonHeaders
          })
        }
        return HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: '잠시 후 다시 시도해 주세요.',
            requestId: '00000000-0000-4000-8000-000000000110',
            retryable: true
          },
          { status: 503 }
        )
      }),
      http.put(draftUrl, () => {
        putCount += 1
        return HttpResponse.json(base, { headers: jsonHeaders })
      })
    )

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: questionIds,
          isInteractionPaused: false,
          sessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))

    await act(async () => {
      await expect(hook.result.current.retrySave()).rejects.toThrow(
        'canonical draft의 revision 또는 내용이 일치하지 않습니다.'
      )
    })
    await waitFor(() =>
      expect(useAppStore.getState().isDraftConflictPending).toBe(true)
    )
    await act(async () => {
      await expect(hook.result.current.retrySave()).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE'
      })
    })
    expect(useAppStore.getState().isDraftConflictPending).toBe(true)

    act(() => {
      hook.result.current.selectOption(questionIds[0], optionIds[0])
    })
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUDY_DRAFT_AUTOSAVE_DELAY_MS + 100)
    })
    expect(putCount).toBe(0)
    expect(
      hook.result.current.snapshot?.answers[0]?.selectedOptionId
    ).toBeNull()
    client.clear()
  })

  it('recovers a fresh boundary failure only after a valid canonical retry', async () => {
    const user = mockDatabase.loginAs('USER')
    const base = createSnapshot()
    let getCount = 0
    mockServer.use(
      http.get(draftUrl, () => {
        getCount += 1
        return HttpResponse.json(
          getCount === 1
            ? {
                ...base,
                studySessionId: '00000000-0000-4000-8000-000000000111'
              }
            : base,
          { headers: jsonHeaders }
        )
      })
    )

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: questionIds,
          isInteractionPaused: false,
          sessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => {
      expect(useAppStore.getState().draftSaveState).toBe('error')
      expect(useAppStore.getState().isDraftConflictPending).toBe(true)
    })
    expect(hook.result.current.isReady).toBe(false)

    await act(async () => {
      await hook.result.current.retrySave()
    })
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))
    expect(useAppStore.getState().isDraftConflictPending).toBe(false)
    expect(useAppStore.getState().draftSaveState).toBe('idle')

    act(() => {
      hook.result.current.selectOption(questionIds[0], optionIds[0])
    })
    expect(hook.result.current.snapshot?.answers[0]?.selectedOptionId).toBe(
      optionIds[0]
    )
    client.clear()
  })

  it('emits a raw canonical GET authentication failure through the central auth boundary', async () => {
    const user = mockDatabase.loginAs('USER')
    const base = createSnapshot()
    const observedErrors: unknown[] = []
    let getCount = 0
    const unsubscribe = subscribeApiError((error) => {
      observedErrors.push(error)
    })

    mockServer.use(
      http.get(draftUrl, () => {
        getCount += 1
        if (getCount === 1) {
          return HttpResponse.json(base, { headers: jsonHeaders })
        }
        return HttpResponse.json(
          {
            code: 'AUTHENTICATION_REQUIRED',
            message: '로그인이 필요합니다.',
            requestId: '00000000-0000-4000-8000-000000000112',
            retryable: false
          },
          { status: 401 }
        )
      })
    )

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: questionIds,
          isInteractionPaused: false,
          sessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))

    await act(async () => {
      await expect(hook.result.current.retrySave()).rejects.toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
        status: 401
      })
    })
    expect(observedErrors).toHaveLength(1)
    expect(observedErrors[0]).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      status: 401
    })

    unsubscribe()
    client.clear()
  })

  it('keeps offline edits local and checks the canonical base before the first reconnect PUT', async () => {
    const user = mockDatabase.loginAs('USER')
    let now = 0
    const performanceNow = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => now)
    const created = await createStudySessionV2({
      count: 3,
      level: 'N5',
      mode: 'RANDOM',
      subject: 'VOCABULARY'
    })
    const reconnectSessionId = created.data.session.id
    const reconnectQuestionIds = created.data.questions.map(
      (question) => question.sessionQuestionId
    )
    const reconnectOptionId = created.data.questions[0]?.question.options[0]?.id
    if (!reconnectOptionId) {
      throw new Error('offline reconnect fixture가 필요합니다.')
    }
    const reconnectDraftUrl = `*/api/v1/study-sessions/${reconnectSessionId}/draft-answers`
    let serverSnapshot = createSnapshot(0, {
      answers: reconnectQuestionIds.map((studySessionQuestionId) => ({
        elapsedSec: 0,
        selectedOptionId: null,
        studySessionQuestionId
      })),
      studySessionId: reconnectSessionId
    })
    const wireOrder: string[] = []
    const online = vi.spyOn(navigator, 'onLine', 'get')
    online.mockReturnValue(true)

    mockServer.use(
      http.get(reconnectDraftUrl, () => {
        wireOrder.push('GET')
        return HttpResponse.json(serverSnapshot, { headers: jsonHeaders })
      }),
      http.put(reconnectDraftUrl, async ({ request }) => {
        wireOrder.push('PUT')
        const body = saveStudyDraftAnswersBodySchema.parse(await request.json())
        serverSnapshot = toAcknowledgement(
          serverSnapshot,
          body,
          serverSnapshot.revision + 1
        )
        return HttpResponse.json(serverSnapshot, { headers: jsonHeaders })
      })
    )

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: reconnectQuestionIds,
          isInteractionPaused: false,
          sessionId: reconnectSessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))
    expect(wireOrder).toEqual(['GET'])

    online.mockReturnValue(false)
    act(() => {
      now = 1_000
      window.dispatchEvent(new Event('offline'))
    })
    act(() => {
      now = 4_000
      hook.result.current.selectOption(
        reconnectQuestionIds[0] ?? '',
        reconnectOptionId
      )
    })

    await act(async () => {
      await new Promise((resolve) =>
        window.setTimeout(resolve, STUDY_DRAFT_AUTOSAVE_DELAY_MS + 100)
      )
    })
    expect(wireOrder).toEqual(['GET'])
    expect(useAppStore.getState().draftSaveState).toBe('offline')
    expect(
      useAppStore.getState().draftWorkingCopy?.localDiff.answers[
        reconnectQuestionIds[0] ?? ''
      ]?.selectedOptionId
    ).toBe(reconnectOptionId)

    online.mockReturnValue(true)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => {
      expect(wireOrder).toContain('PUT')
      expect(hook.result.current.saveState).toBe('saved')
      expect(hook.result.current.snapshot?.revision).toBe(1)
      expect(serverSnapshot.answers[0]?.selectedOptionId).toBe(
        reconnectOptionId
      )
      expect(serverSnapshot.answers[0]?.elapsedSec).toBe(4)
    })
    const firstPutIndex = wireOrder.indexOf('PUT')
    expect(firstPutIndex).toBeGreaterThan(1)
    expect(wireOrder.slice(1, firstPutIndex)).toContain('GET')

    online.mockRestore()
    performanceNow.mockRestore()
    hook.unmount()
    await act(async () => {
      await client.cancelQueries()
      client.clear()
    })
  })

  it('flushes foreground elapsed time before reconciling an automatic newer Query snapshot', async () => {
    const user = mockDatabase.loginAs('USER')
    let now = 0
    const performanceNow = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => now)
    const base = createSnapshot()

    mockServer.use(
      http.get(draftUrl, () =>
        HttpResponse.json(base, { headers: jsonHeaders })
      )
    )

    const client = createClient()
    const hook = renderHook(
      () =>
        usePracticeDraftController({
          enabled: true,
          expectedSessionQuestionIds: questionIds,
          isInteractionPaused: false,
          sessionId,
          user
        }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))

    now = 5_200
    const remote = createSnapshot(1, {
      answers: base.answers.map((answer, index) =>
        index === 1 ? { ...answer, selectedOptionId: optionIds[1] } : answer
      )
    })
    act(() => {
      client.setQueryData(serverStateQueryKeys.study.draft(sessionId), remote)
    })

    await waitFor(() => {
      expect(hook.result.current.snapshot?.revision).toBe(1)
      expect(hook.result.current.snapshot?.answers[0]?.elapsedSec).toBe(5)
      expect(hook.result.current.snapshot?.answers[1]?.selectedOptionId).toBe(
        optionIds[1]
      )
    })
    expect(useAppStore.getState().draftSaveState).toBe('dirty')

    performanceNow.mockRestore()
    client.clear()
  })
})
