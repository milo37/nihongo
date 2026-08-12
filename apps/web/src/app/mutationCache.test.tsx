import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import { useDeleteAdminQuestion } from '@app/admin-question/hooks/useDeleteAdminQuestion'
import { useUpdateAdminQuestion } from '@app/admin-question/hooks/useUpdateAdminQuestion'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import { useSubmitStudySession } from '@app/practice/hooks/useSubmitStudySession'
import { studyQueries } from '@app/practice/queries/studyQueries'
import { useReviewWrongNote } from '@app/wrong-note/hooks/useReviewWrongNote'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import type { UpdateAdminQuestionRequest } from '@api/admin-question/updateAdminQuestion/schema'
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

const toUpdateInput = (
  questionId: string,
  questionText: string
): UpdateAdminQuestionRequest => {
  const question = mockDatabase.getAdminQuestion(questionId)
  const correctOption = question.options.find((option) => option.isCorrect)

  if (!correctOption) {
    throw new Error('테스트 문제에 정답이 없습니다.')
  }

  return {
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    passage: question.passage,
    questionText,
    options: question.options.map(({ id, label, text }) => ({
      id,
      label,
      text
    })),
    correctOptionId: correctOption.id,
    explanationKo: question.explanationKo,
    explanationJa: question.explanationJa,
    difficulty: question.difficulty,
    tags: question.tags,
    status: question.status
  }
}

describe('mutation cache contracts', () => {
  it('학습 제출 성공 후 결과를 저장하고 관련 캐시 무효화를 기다린다', async () => {
    const sessionPayload = mockDatabase.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionId = sessionPayload.session.id
    const question = mockDatabase.getAdminQuestion(
      sessionPayload.questions[0].id
    )
    const selectedOptionId = question.options[0].id
    const client = createTestClient()

    seedCache(client, studyQueries.session(sessionId).queryKey)
    seedCache(client, [...wrongNoteQueries.allKey(), 'seed'])
    seedCache(client, [...dashboardQueries.allKey(), 'seed'])

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
    expectInvalidated(client, [...dashboardQueries.allKey(), 'seed'])
  })

  it('mutateAsync는 병렬 cache invalidation이 모두 끝날 때까지 pending을 유지한다', async () => {
    const sessionPayload = mockDatabase.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionId = sessionPayload.session.id
    const question = mockDatabase.getAdminQuestion(
      sessionPayload.questions[0].id
    )
    const client = createTestClient()
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
            selectedOptionId: question.options[0].id,
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
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const

    seedCache(client, sessionKey)
    seedCache(client, wrongKey)
    seedCache(client, dashboardKey)

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
    expect(client.getQueryState(dashboardKey)?.isInvalidated).toBe(false)
    expect(
      client.getQueryData(studyQueries.result('missing-session').queryKey)
    ).toBeUndefined()
  })

  it('오답 복습 성공 후 오답과 대시보드 캐시를 함께 무효화한다', async () => {
    mockDatabase.loginAs('USER')
    const sessionPayload = mockDatabase.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const question = mockDatabase.getAdminQuestion(
      sessionPayload.questions[0].id
    )
    const incorrectOption = question.options.find((option) => !option.isCorrect)

    if (!incorrectOption) {
      throw new Error('테스트 문제에 오답 보기가 없습니다.')
    }

    mockDatabase.submitStudySession({
      sessionId: sessionPayload.session.id,
      answers: [
        {
          questionId: question.id,
          selectedOptionId: incorrectOption.id,
          elapsedSec: 2
        }
      ],
      durationSec: 2
    })

    const client = createTestClient()
    const wrongKey = [...wrongNoteQueries.allKey(), 'seed'] as const
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const
    seedCache(client, wrongKey)
    seedCache(client, dashboardKey)

    const { result } = renderHook(() => useReviewWrongNote(question.id), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync({ isCorrect: true })
    })

    expectInvalidated(client, wrongKey)
    expectInvalidated(client, dashboardKey)
  })

  it('오답 복습 실패 시 성공용 캐시 무효화를 실행하지 않는다', async () => {
    mockDatabase.loginAs('USER')
    const client = createTestClient()
    const wrongKey = [...wrongNoteQueries.allKey(), 'seed'] as const
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const
    seedCache(client, wrongKey)
    seedCache(client, dashboardKey)

    const { result } = renderHook(
      () => useReviewWrongNote('missing-question'),
      { wrapper: createWrapper(client) }
    )

    await expect(
      act(async () => {
        await result.current.mutateAsync({ isCorrect: true })
      })
    ).rejects.toBeDefined()
    expect(client.getQueryState(wrongKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(dashboardKey)?.isInvalidated).toBe(false)
  })

  it('관리자 수정은 상세 데이터를 갱신하고 교차 도메인 캐시를 무효화한다', async () => {
    mockDatabase.loginAs('ADMIN')
    const questionId = 'n5-vocabulary-01'
    const questionText = '수정된 관리자 문제 문장'
    const client = createTestClient()
    const detailKey = adminQuestionQueries.detail(questionId).queryKey
    const bookmarkKey = [...bookmarkQueries.allKey(), 'seed'] as const
    const wrongKey = [...wrongNoteQueries.allKey(), 'seed'] as const
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const

    seedCache(client, detailKey)
    seedCache(client, bookmarkKey)
    seedCache(client, wrongKey)
    seedCache(client, dashboardKey)

    const { result } = renderHook(() => useUpdateAdminQuestion(), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync({
        questionId,
        input: toUpdateInput(questionId, questionText)
      })
    })

    expect(client.getQueryData(detailKey)).toMatchObject({ questionText })
    expectInvalidated(client, detailKey)
    expectInvalidated(client, bookmarkKey)
    expectInvalidated(client, wrongKey)
    expectInvalidated(client, dashboardKey)
  })

  it('관리자 삭제는 상세 캐시를 제거하고 모든 관련 목록을 무효화한다', async () => {
    mockDatabase.loginAs('ADMIN')
    const questionId = 'n5-vocabulary-02'
    const client = createTestClient()
    const detailKey = adminQuestionQueries.detail(questionId).queryKey
    const listKey = adminQuestionQueries.list({
      page: 1,
      pageSize: 20,
      sort: 'RECENT'
    }).queryKey
    const bookmarkKey = [...bookmarkQueries.allKey(), 'seed'] as const
    const wrongKey = [...wrongNoteQueries.allKey(), 'seed'] as const
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const

    seedCache(client, detailKey)
    seedCache(client, listKey)
    seedCache(client, bookmarkKey)
    seedCache(client, wrongKey)
    seedCache(client, dashboardKey)

    const { result } = renderHook(() => useDeleteAdminQuestion(), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync(questionId)
    })

    expect(client.getQueryState(detailKey)).toBeUndefined()
    expectInvalidated(client, listKey)
    expectInvalidated(client, bookmarkKey)
    expectInvalidated(client, wrongKey)
    expectInvalidated(client, dashboardKey)
  })

  it('관리자 수정·삭제 실패 시 상세 set/remove와 교차 무효화를 실행하지 않는다', async () => {
    mockDatabase.loginAs('ADMIN')
    const client = createTestClient()
    const missingQuestionId = 'missing-question'
    const detailKey = adminQuestionQueries.detail(missingQuestionId).queryKey
    const listKey = adminQuestionQueries.list({
      page: 1,
      pageSize: 20,
      sort: 'RECENT'
    }).queryKey
    const bookmarkKey = [...bookmarkQueries.allKey(), 'seed'] as const
    const wrongKey = [...wrongNoteQueries.allKey(), 'seed'] as const
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const
    seedCache(client, detailKey)
    seedCache(client, listKey)
    seedCache(client, bookmarkKey)
    seedCache(client, wrongKey)
    seedCache(client, dashboardKey)

    const updateHook = renderHook(() => useUpdateAdminQuestion(), {
      wrapper: createWrapper(client)
    })
    const deleteHook = renderHook(() => useDeleteAdminQuestion(), {
      wrapper: createWrapper(client)
    })
    const validInput = toUpdateInput(
      'n5-vocabulary-01',
      '실패 테스트용 문제 문장'
    )

    await expect(
      act(async () => {
        await updateHook.result.current.mutateAsync({
          questionId: missingQuestionId,
          input: validInput
        })
      })
    ).rejects.toBeDefined()
    await expect(
      act(async () => {
        await deleteHook.result.current.mutateAsync(missingQuestionId)
      })
    ).rejects.toBeDefined()

    expect(client.getQueryData(detailKey)).toEqual({ cached: true })
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(bookmarkKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(wrongKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(dashboardKey)?.isInvalidated).toBe(false)
  })
})
