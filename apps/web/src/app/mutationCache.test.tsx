import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import { useSubmitStudySession } from '@app/practice/hooks/useSubmitStudySession'
import { studyQueries } from '@app/practice/queries/studyQueries'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const createTestClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })

const createWrapper = (
  client: QueryClient
): ((props: { children: ReactNode }) => ReactElement) => {
  return ({ children }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const seedCache = (client: QueryClient, queryKey: readonly unknown[]): void => {
  client.setQueryData(queryKey, { cached: true })
}

const expectInvalidated = (
  client: QueryClient,
  queryKey: readonly unknown[]
): void => {
  expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true)
}

describe('mutation cache contracts', () => {
  it('학습 제출 성공 후 결과를 저장하고 관련 캐시 무효화를 기다린다', async () => {
    mockDatabase.loginAs('USER')
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionView = toCanonicalStudySessionView(sessionPayload)
    const sessionId = sessionPayload.session.id
    const question = sessionView.questions[0]

    if (!question) {
      throw new Error('테스트 세션에 문제가 없습니다.')
    }

    const selectedOptionId = question.options[0]?.id ?? null
    const client = createTestClient()

    client.setQueryData(studyQueries.session(sessionId).queryKey, sessionView)
    seedCache(client, [...wrongNoteQueries.allKey(), 'seed'])
    seedCache(client, dashboardQueries.stats().queryKey)
    seedCache(client, dashboardQueries.insights().queryKey)

    const { result } = renderHook(() => useSubmitStudySession(sessionId), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync({
        answers: [
          {
            questionId: question.id,
            selectedOptionId,
            elapsedSec: 3
          }
        ],
        durationSec: 3
      })
    })

    expect(
      client.getQueryData(studyQueries.result(sessionId).queryKey)
    ).toMatchObject({ sessionId })
    expectInvalidated(client, studyQueries.session(sessionId).queryKey)
    expectInvalidated(client, [...wrongNoteQueries.allKey(), 'seed'])
    expectInvalidated(client, dashboardQueries.stats().queryKey)
    expectInvalidated(client, dashboardQueries.insights().queryKey)
  })

  it('mutateAsync는 병렬 cache invalidation이 모두 끝날 때까지 pending을 유지한다', async () => {
    mockDatabase.loginAs('USER')
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionView = toCanonicalStudySessionView(sessionPayload)
    const sessionId = sessionPayload.session.id
    const question = sessionView.questions[0]

    if (!question) {
      throw new Error('테스트 세션에 문제가 없습니다.')
    }

    const client = createTestClient()
    client.setQueryData(studyQueries.session(sessionId).queryKey, sessionView)
    const originalInvalidateQueries = client.invalidateQueries.bind(client)
    let releaseInvalidations: (() => void) | undefined
    const invalidationGate = new Promise<void>((resolve) => {
      releaseInvalidations = resolve
    })
    const invalidateQueries = vi
      .spyOn(client, 'invalidateQueries')
      .mockImplementation(async (filters, options) => {
        await invalidationGate
        return originalInvalidateQueries(filters, options)
      })
    const { result } = renderHook(() => useSubmitStudySession(sessionId), {
      wrapper: createWrapper(client)
    })
    let mutationPromise: Promise<unknown> | undefined

    act(() => {
      mutationPromise = result.current.mutateAsync({
        answers: [
          {
            questionId: question.id,
            selectedOptionId: question.options[0]?.id ?? null,
            elapsedSec: 3
          }
        ],
        durationSec: 3
      })
    })

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(3))
    expect(result.current.isPending).toBe(true)

    await act(async () => {
      releaseInvalidations?.()
      await mutationPromise
    })
    await waitFor(() => expect(result.current.isPending).toBe(false))
  })

  it('학습 제출 실패 시 기존 캐시를 무효화하지 않는다', async () => {
    const client = createTestClient()
    const sessionKey = studyQueries.session('missing-session').queryKey
    const wrongKey = [...wrongNoteQueries.allKey(), 'seed'] as const
    const dashboardStatsKey = dashboardQueries.stats().queryKey
    const dashboardInsightsKey = dashboardQueries.insights().queryKey

    seedCache(client, sessionKey)
    seedCache(client, wrongKey)
    seedCache(client, dashboardStatsKey)
    seedCache(client, dashboardInsightsKey)

    const { result } = renderHook(
      () => useSubmitStudySession('missing-session'),
      { wrapper: createWrapper(client) }
    )

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          answers: [],
          durationSec: 0
        })
      })
    ).rejects.toBeDefined()

    expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(wrongKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(dashboardStatsKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(dashboardInsightsKey)?.isInvalidated).toBe(
      false
    )
    expect(
      client.getQueryData(studyQueries.result('missing-session').queryKey)
    ).toBeUndefined()
  })
})
