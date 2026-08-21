import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toVersionedContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import { mockCanonicalSubmissionV2Operations } from '@mocks/adapters/studySubmissionContractAdapter'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { useCreateResultRetrySession } from '@app/practice/hooks/useCreateResultRetrySession'
import { commitCanonicalAuth } from '@app/login/authSession'
import {
  getOrCreateResultRetryAttempt,
  readResultRetryAttempt
} from '@app/practice/resultRetryAttemptStorage'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { demoUsers } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

const RETRY_URL = '*/api/v1/study-sessions/:sessionId/retry'
const SESSION_URL = '*/api/v1/study-sessions/:sessionId'

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

const createWrapper =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

const createSubmittedSource = (): {
  principalScope: string
  sourceSessionId: string
} => {
  const user = mockDatabase.loginAs('USER')
  const created = mockDatabase.createStudySession({
    canonicalContractVersion: 2,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1,
    questionIds: ['n5-vocabulary-01']
  })
  const payload = toVersionedContractStudySessionPayload(
    mockDatabase.getCanonicalStudySessionSnapshotRecord(
      created.session.id,
      null
    )
  )
  mockDatabase.submitCanonicalStudySession(
    {
      body: {
        answers: payload.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      },
      contractVersion: 2,
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId: created.session.id
    },
    mockCanonicalSubmissionV2Operations
  )

  return {
    principalScope: getStudyDraftPrincipalScope(user),
    sourceSessionId: created.session.id
  }
}

const retryResponseHeaders = (
  targetSessionId: string,
  replayed: boolean
): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  Location: `/api/v1/study-sessions/${targetSessionId}`,
  'X-Nihongo-Practice-Contract': '2',
  ...(replayed ? { 'Idempotency-Replayed': 'true' } : {})
})

const sessionResponseHeaders = (): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Nihongo-Practice-Contract': '2'
})

const createDeferred = (): {
  promise: Promise<void>
  release: () => void
} => {
  let release: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release?.() }
}

describe('useCreateResultRetrySession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('commit 뒤 응답 검증 실패에도 동일 key를 보존하고 exact replay한다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { principalScope, sourceSessionId } = createSubmittedSource()
    const observedKeys: string[] = []
    let requestCount = 0
    mockServer.use(
      http.post(RETRY_URL, ({ request }) => {
        requestCount += 1
        const idempotencyKey = request.headers.get('Idempotency-Key') ?? ''
        observedKeys.push(idempotencyKey)
        const created = mockDatabase.createCanonicalResultRetry({
          guestPrincipalId: null,
          idempotencyKey,
          sourceSessionId
        })
        return HttpResponse.json(created.response, {
          status: 201,
          headers: {
            ...retryResponseHeaders(
              created.response.session.id,
              created.replayed
            ),
            ...(requestCount === 1
              ? {
                  Location: `/api/v1/study-sessions/${crypto.randomUUID()}`
                }
              : {})
          }
        })
      })
    )
    const client = createClient()
    const sourceResultKey = serverStateQueryKeys.study.result(sourceSessionId)
    const resumableKey = serverStateQueryKeys.study.resumable({
      page: 1,
      pageSize: 5
    })
    client.setQueryData(sourceResultKey, { source: true })
    client.setQueryData(resumableKey, { items: [], page: 1, pageSize: 5 })
    const hook = renderHook(() => useCreateResultRetrySession(), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      await expect(
        hook.result.current.mutateAsync({ principalScope, sourceSessionId })
      ).rejects.toMatchObject({
        isResponseValidationError: true,
        status: 422
      })
    })
    const frozenAttempt = readResultRetryAttempt(
      principalScope,
      sourceSessionId
    )
    expect(frozenAttempt?.idempotencyKey).toBe(observedKeys[0])
    expect(
      mockDatabase
        .getCanonicalIdempotencyRecords()
        .filter(
          ({ operation }) => operation === 'study.createResultRetrySession'
        )
    ).toHaveLength(1)

    let replayedTargetId = ''
    await act(async () => {
      const replayed = await hook.result.current.mutateAsync({
        principalScope,
        sourceSessionId
      })
      expect(replayed.replayed).toBe(true)
      replayedTargetId = replayed.session.session.id
    })

    expect(observedKeys).toEqual([
      frozenAttempt?.idempotencyKey,
      frozenAttempt?.idempotencyKey
    ])
    expect(readResultRetryAttempt(principalScope, sourceSessionId)).toBeNull()
    expect(
      client.getQueryData(serverStateQueryKeys.study.session(replayedTargetId))
    ).toMatchObject({ session: { id: replayedTargetId } })
    expect(client.getQueryState(resumableKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(sourceResultKey)?.isInvalidated).toBe(false)
    expect(consoleError).toHaveBeenCalled()
    client.clear()
  })

  it('replay target canonical GET 실패 뒤에도 key를 보존하고 다시 수렴한다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { principalScope, sourceSessionId } = createSubmittedSource()
    const attempt = getOrCreateResultRetryAttempt(
      principalScope,
      sourceSessionId
    )
    const committed = mockDatabase.createCanonicalResultRetry({
      guestPrincipalId: null,
      idempotencyKey: attempt.idempotencyKey,
      sourceSessionId
    })
    const targetSessionId = committed.response.session.id
    let targetGetCount = 0
    const observedKeys: string[] = []
    mockServer.use(
      http.post(RETRY_URL, ({ request }) => {
        const idempotencyKey = request.headers.get('Idempotency-Key') ?? ''
        observedKeys.push(idempotencyKey)
        const replayed = mockDatabase.createCanonicalResultRetry({
          guestPrincipalId: null,
          idempotencyKey,
          sourceSessionId
        })
        return HttpResponse.json(replayed.response, {
          status: 201,
          headers: retryResponseHeaders(
            replayed.response.session.id,
            replayed.replayed
          )
        })
      }),
      http.get(SESSION_URL, ({ params }) => {
        if (String(params.sessionId) !== targetSessionId) {
          return HttpResponse.json({}, { status: 404 })
        }
        targetGetCount += 1
        if (targetGetCount === 1) {
          return HttpResponse.json(
            { session: { id: targetSessionId } },
            { headers: sessionResponseHeaders() }
          )
        }
        return HttpResponse.json(
          toVersionedContractStudySessionPayload(
            mockDatabase.getCanonicalStudySessionSnapshotRecord(
              targetSessionId,
              null
            )
          ),
          { headers: sessionResponseHeaders() }
        )
      })
    )
    const client = createClient()
    const hook = renderHook(() => useCreateResultRetrySession(), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      await expect(
        hook.result.current.mutateAsync({ principalScope, sourceSessionId })
      ).rejects.toMatchObject({ name: 'ResultRetryReconciliationError' })
    })
    expect(
      readResultRetryAttempt(principalScope, sourceSessionId)?.idempotencyKey
    ).toBe(attempt.idempotencyKey)

    await act(async () => {
      const replayed = await hook.result.current.mutateAsync({
        principalScope,
        sourceSessionId
      })
      expect(replayed.session.session.id).toBe(targetSessionId)
    })
    expect(observedKeys).toEqual([
      attempt.idempotencyKey,
      attempt.idempotencyKey
    ])
    expect(consoleError).toHaveBeenCalled()
    expect(targetGetCount).toBe(2)
    expect(readResultRetryAttempt(principalScope, sourceSessionId)).toBeNull()
    client.clear()
  })

  it('offline request를 전송하지 않고 reconnect 뒤 같은 key로 한 번 보낸다', async () => {
    const { principalScope, sourceSessionId } = createSubmittedSource()
    let requestCount = 0
    let observedKey = ''
    mockServer.use(
      http.post(RETRY_URL, ({ request }) => {
        requestCount += 1
        observedKey = request.headers.get('Idempotency-Key') ?? ''
        const created = mockDatabase.createCanonicalResultRetry({
          guestPrincipalId: null,
          idempotencyKey: observedKey,
          sourceSessionId
        })
        return HttpResponse.json(created.response, {
          status: 201,
          headers: retryResponseHeaders(
            created.response.session.id,
            created.replayed
          )
        })
      })
    )
    const client = createClient()
    const hook = renderHook(() => useCreateResultRetrySession(), {
      wrapper: createWrapper(client)
    })

    act(() => onlineManager.setOnline(false))
    act(() => {
      hook.result.current.mutate({ principalScope, sourceSessionId })
    })
    await waitFor(() => {
      expect(hook.result.current.isPaused).toBe(true)
      expect(hook.result.current.isPending).toBe(true)
    })
    expect(requestCount).toBe(0)
    const frozenAttempt = readResultRetryAttempt(
      principalScope,
      sourceSessionId
    )
    expect(frozenAttempt).not.toBeNull()

    act(() => onlineManager.setOnline(true))
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true)
      expect(hook.result.current.isPending).toBe(false)
    })
    expect(requestCount).toBe(1)
    expect(observedKey).toBe(frozenAttempt?.idempotencyKey)
    expect(readResultRetryAttempt(principalScope, sourceSessionId)).toBeNull()
    client.clear()
  })

  it('replay canonical GET 중 account switch가 나면 이전 cache와 오류를 노출하지 않는다', async () => {
    const { principalScope, sourceSessionId } = createSubmittedSource()
    const admin = demoUsers.find(({ role }) => role === 'ADMIN')
    if (!admin) {
      throw new Error('ADMIN auth transition fixture가 필요합니다.')
    }
    const attempt = getOrCreateResultRetryAttempt(
      principalScope,
      sourceSessionId
    )
    const committed = mockDatabase.createCanonicalResultRetry({
      guestPrincipalId: null,
      idempotencyKey: attempt.idempotencyKey,
      sourceSessionId
    })
    const targetSessionId = committed.response.session.id
    const targetGetGate = createDeferred()
    let targetGetStarted = false
    mockServer.use(
      http.post(RETRY_URL, () =>
        HttpResponse.json(committed.response, {
          status: 201,
          headers: retryResponseHeaders(targetSessionId, true)
        })
      ),
      http.get(SESSION_URL, async () => {
        targetGetStarted = true
        await targetGetGate.promise
        return HttpResponse.json(
          toVersionedContractStudySessionPayload(
            mockDatabase.getCanonicalStudySessionSnapshotRecord(
              targetSessionId,
              null
            )
          ),
          { headers: sessionResponseHeaders() }
        )
      })
    )
    const client = createClient()
    const hook = renderHook(() => useCreateResultRetrySession(), {
      wrapper: createWrapper(client)
    })
    let pendingMutation: Promise<unknown> | undefined

    act(() => {
      pendingMutation = hook.result.current.mutateAsync({
        principalScope,
        sourceSessionId
      })
      void pendingMutation.catch(() => undefined)
    })
    await waitFor(() => expect(targetGetStarted).toBe(true))
    await act(async () => {
      await commitCanonicalAuth(client, admin, {
        forceClear: true,
        forcePracticeReset: true
      })
      targetGetGate.release()
    })

    if (!pendingMutation) {
      throw new Error('retry mutation promise가 필요합니다.')
    }
    await expect(pendingMutation).rejects.toMatchObject({
      name: 'AuthTransitionSupersededError'
    })
    expect(
      client.getQueryData(serverStateQueryKeys.study.session(targetSessionId))
    ).toBeUndefined()
    expect(readResultRetryAttempt(principalScope, sourceSessionId)).toBeNull()
    client.clear()
  })
})
