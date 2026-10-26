import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { getWrongNoteMemo } from '@api/wrong-note/getWrongNoteMemo'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { useUpdateWrongNoteMemo } from '@app/wrong-note/hooks/useUpdateWrongNoteMemo'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { AuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

const renderMemoAction = async () => {
  mockDatabase.loginAs('USER')
  const created = await createStudySessionV1({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1
  })
  const question = toCanonicalStudySessionView(created).questions[0]
  if (!question?.sessionQuestionId)
    throw new Error('Canonical question fixture required')
  await submitStudySessionV1(
    created.session.id,
    {
      answers: [
        {
          studySessionQuestionId: question.sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        }
      ],
      durationSec: 0
    },
    crypto.randomUUID()
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  await commitCanonicalAuth(
    client,
    await client.fetchQuery(authQueries.currentUser())
  )
  await client.fetchQuery(wrongNoteQueries.memo(question.id))
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useUpdateWrongNoteMemo(question.id), {
    wrapper
  })
  return {
    ...hook,
    client,
    questionId: question.id,
    memoKey: wrongNoteQueries.memo(question.id).queryKey
  }
}

describe('canonical memo action without a page editor', () => {
  it('저장 성공의 확정 메모를 캐시에 반영하고 복습 목록을 다시 확인한다', async () => {
    const { result, client, questionId, memoKey } = await renderMemoAction()
    const queue = wrongNoteQueries.reviewQueue({ view: 'UNREVIEWED' })
    const before = await client.fetchQuery(queue)
    expect(
      before.items.find((item) => item.questionId === questionId)?.hasMemo
    ).toBe(false)
    const input = { memo: '  동사 활용을 다시 확인  ' }
    await act(async () => {
      await result.current.mutateAsync(input)
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const confirmed = await getWrongNoteMemo(questionId)
    expect(confirmed).toMatchObject({
      questionId,
      text: '동사 활용을 다시 확인'
    })
    expect(client.getQueryData(memoKey)).toEqual(confirmed)
    expect(client.getQueryState(queue.queryKey)?.isInvalidated).toBe(true)
    const after = await client.fetchQuery(queue)
    expect(
      after.items.find((item) => item.questionId === questionId)?.hasMemo
    ).toBe(true)
    expect(input.memo).toBe('  동사 활용을 다시 확인  ')
  })

  it('저장 대기와 실패를 노출하고 입력·이전 캐시를 보존하여 명시적으로 재시도한다', async () => {
    const { result, client, questionId, memoKey } = await renderMemoAction()
    const before = client.getQueryData(memoKey)
    const input = { memo: '실패해도 남아야 하는 메모' }
    let requests = 0
    let release = (): void => {}
    const responseReady = new Promise<void>((resolve) => {
      release = resolve
    })
    mockServer.use(
      http.put(
        `*/api/v1/wrong-notes/${questionId}/memo`,
        async ({ request }) => {
          requests += 1
          expect(await request.json()).toEqual(input)
          await responseReady
          return HttpResponse.json(
            {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'temporary memo error',
              requestId: crypto.randomUUID(),
              retryable: true
            },
            { status: 500 }
          )
        }
      )
    )
    let failure: Promise<unknown> = Promise.resolve()
    act(() => {
      failure = result.current
        .mutateAsync(input)
        .catch((error: unknown) => error)
    })
    await waitFor(() => expect(result.current.isPending).toBe(true))
    await waitFor(() => expect(requests).toBe(1))
    expect(result.current.variables).toEqual(input)
    expect(client.getQueryData(memoKey)).toEqual(before)
    await act(async () => {
      release()
      await failure
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 500 })
    expect(result.current.variables).toEqual(input)
    expect(client.getQueryData(memoKey)).toEqual(before)
    expect(await getWrongNoteMemo(questionId)).toBeNull()
    // No automatic replay after a failed save; a caller must explicitly retry.
    expect(requests).toBe(1)
    mockServer.resetHandlers()
    await act(async () => {
      await result.current.mutateAsync({ ...input })
    })
    expect(client.getQueryData(memoKey)).toMatchObject({ text: input.memo })
    expect(await getWrongNoteMemo(questionId)).toEqual(
      client.getQueryData(memoKey)
    )
  })

  it('로그아웃 전에 시작한 저장 응답을 다른 인증 문맥의 캐시에 쓰지 않는다', async () => {
    const { result, client, questionId, memoKey } = await renderMemoAction()
    let release = (): void => {}
    const responseReady = new Promise<void>((resolve) => {
      release = resolve
    })
    let requests = 0
    mockServer.use(
      http.put(`*/api/v1/wrong-notes/${questionId}/memo`, async () => {
        requests += 1
        await responseReady
        return HttpResponse.json({
          questionId,
          text: '이전 사용자 메모',
          createdAt: '2026-10-12T00:00:00.000Z',
          updatedAt: '2026-10-12T00:00:00.000Z'
        })
      })
    )
    let settled: Promise<unknown> = Promise.resolve()
    act(() => {
      settled = result.current
        .mutateAsync({ memo: '이전 사용자 메모' })
        .catch((error: unknown) => error)
    })
    await waitFor(() => expect(requests).toBe(1))
    mockDatabase.logout()
    await act(async () => {
      await commitCanonicalAuth(
        client,
        await client.fetchQuery({ ...authQueries.currentUser(), staleTime: 0 })
      )
    })
    expect(client.getQueryData(memoKey)).toBeUndefined()
    let error: unknown
    await act(async () => {
      release()
      error = await settled
    })
    expect(error).toBeInstanceOf(AuthTransitionSupersededError)
    expect(client.getQueryData(memoKey)).toBeUndefined()
    expect(client.getQueryData(authQueries.currentUser().queryKey)).toBeNull()
  })
})
