import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { authQueries } from '@app/login/queries/authQueries'
import { commitCanonicalAuth } from '@app/login/authSession'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
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
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import { useCreateTargetedReviewSession } from '@app/wrong-note/hooks/useCreateTargetedReviewSession'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { useAppStore } from '@store/index'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import type { UpdateAdminQuestionRequest } from '@api/admin-question/updateAdminQuestion/schema'
import { createAdminQuestion } from '@api/admin-question/createAdminQuestion'
import { getAdminQuestion } from '@api/admin-question/getAdminQuestion'
import { previewQuestionVersion } from '@api/admin-question/previewQuestionVersion'
import { createInput } from '@app/admin-question/test/questionFixture'
import { adminQuestionHandlers } from '@mocks/handlers/adminQuestionHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

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

const prepareAdminQuestion = async (questionText: string) => {
  const created = await createAdminQuestion({
    ...createInput,
    tagNames: ['규칙']
  })
  const { questionVersionId: versionId, versionRowVersion: rowVersion } =
    created
  if (
    created.versionStatus !== 'DRAFT' ||
    versionId === null ||
    rowVersion === null
  ) {
    throw new Error('Expected a created draft with a version and row version')
  }
  const detail = await getAdminQuestion(created.questionId)
  const preview = await previewQuestionVersion(versionId)
  const input: UpdateAdminQuestionRequest = {
    level: preview.question.level,
    subject: preview.question.subject,
    questionType: preview.question.questionType,
    passage: preview.question.passage,
    questionText,
    difficulty: preview.question.difficulty,
    explanationKo: preview.adminAnswer.explanationKo,
    explanationJa: preview.adminAnswer.explanationJa,
    tagNames: preview.question.tags.map(({ label }) => label),
    expectedRowVersion: rowVersion,
    options: preview.question.options.map(({ id, text }, index) => ({
      id,
      text,
      ordinal: index + 1
    })),
    correctOptionId: preview.adminAnswer.correctOptionId
  }
  return {
    questionId: created.questionId,
    versionId,
    detail,
    input
  }
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

    client.setQueryData(
      studySessionQueries.session(sessionId).queryKey,
      sessionView
    )
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
    expectInvalidated(client, studySessionQueries.session(sessionId).queryKey)
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
    client.setQueryData(
      studySessionQueries.session(sessionId).queryKey,
      sessionView
    )
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
    const sessionKey = studySessionQueries.session('missing-session').queryKey
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

  it('오답 복습 성공 후 오답과 대시보드 캐시를 함께 무효화한다', async () => {
    mockDatabase.loginAs('USER')
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const question = toCanonicalStudySessionView(sessionPayload).questions[0]
    if (!question || !question.sessionQuestionId) {
      throw new Error('A canonical session-question fixture is required.')
    }
    await submitStudySessionV1(
      sessionPayload.session.id,
      {
        answers: [
          {
            studySessionQuestionId: question.sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 2
          }
        ],
        durationSec: 2
      },
      crypto.randomUUID()
    )

    const client = createTestClient()
    const currentUser = await client.fetchQuery(authQueries.currentUser())
    expect(currentUser?.role).toBe('USER')
    await commitCanonicalAuth(client, currentUser)
    const wrongKey = wrongNoteQueries.detail(question.id).queryKey
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const
    seedCache(client, wrongKey)
    seedCache(client, dashboardKey)

    const { result } = renderHook(() => useCreateTargetedReviewSession(), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      const created = await result.current.mutateAsync({
        questionId: question.id,
        principalScope: getStudyDraftPrincipalScope(
          useAppStore.getState().currentUser
        )
      })
      expect(created.session.questions.map(({ id }) => id)).toEqual([
        question.id
      ])
    })

    expectInvalidated(client, wrongKey)
    expectInvalidated(client, dashboardKey)
  })

  it('오답 복습 실패 시 성공용 캐시 무효화를 실행하지 않는다', async () => {
    mockDatabase.loginAs('USER')
    const client = createTestClient()
    const currentUser = await client.fetchQuery(authQueries.currentUser())
    expect(currentUser?.role).toBe('USER')
    await commitCanonicalAuth(client, currentUser)
    const wrongKey = wrongNoteQueries.detail(
      '00000000-0000-4000-8000-ffffffffffff'
    ).queryKey
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const
    seedCache(client, wrongKey)
    seedCache(client, dashboardKey)

    const { result } = renderHook(() => useCreateTargetedReviewSession(), {
      wrapper: createWrapper(client)
    })

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          questionId: '00000000-0000-4000-8000-ffffffffffff',
          principalScope: getStudyDraftPrincipalScope(
            useAppStore.getState().currentUser
          )
        })
      })
    ).rejects.toBeDefined()
    expect(client.getQueryState(wrongKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(dashboardKey)?.isInvalidated).toBe(false)
  })

  it('관리자 수정은 상세 데이터를 갱신하고 교차 도메인 캐시를 무효화한다', async () => {
    mockServer.use(...adminQuestionHandlers)
    mockDatabase.loginAs('ADMIN')
    const questionText = '수정된 관리자 문제 문장'
    const { questionId, versionId, detail, input } =
      await prepareAdminQuestion(questionText)
    const client = createTestClient()
    const detailKey = adminQuestionQueries.detail(questionId).queryKey
    const bookmarkKey = [...bookmarkQueries.allKey(), 'seed'] as const
    const wrongKey = [...wrongNoteQueries.allKey(), 'seed'] as const
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const

    client.setQueryData(detailKey, detail)
    seedCache(client, bookmarkKey)
    seedCache(client, wrongKey)
    seedCache(client, dashboardKey)

    const { result } = renderHook(() => useUpdateAdminQuestion(), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync({
        questionId,
        versionId,
        input
      })
    })

    expect(client.getQueryData(detailKey)).toEqual(detail)
    expectInvalidated(client, detailKey)
    expectInvalidated(client, bookmarkKey)
    expectInvalidated(client, wrongKey)
    expectInvalidated(client, dashboardKey)
    const refreshed = await client.fetchQuery(
      adminQuestionQueries.detail(questionId)
    )
    expect(refreshed.versions.items[0]).toMatchObject({
      questionVersionId: versionId,
      rowVersion: input.expectedRowVersion + 1
    })
    expect(
      (await previewQuestionVersion(versionId)).question.questionText
    ).toBe(questionText)
  })

  it('관리자 삭제는 상세 캐시를 제거하고 모든 관련 목록을 무효화한다', async () => {
    mockServer.use(...adminQuestionHandlers)
    mockDatabase.loginAs('ADMIN')
    const { questionId, versionId, detail } =
      await prepareAdminQuestion('보관할 문제')
    const client = createTestClient()
    const detailKey = adminQuestionQueries.detail(questionId).queryKey
    const listKey = adminQuestionQueries.list({
      page: 1,
      pageSize: 20,
      sort: 'UPDATED_DESC'
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
      await result.current.mutateAsync({
        questionId,
        input: {
          expectedQuestionRowVersion: detail.question.rowVersion,
          expectedOpenCandidateVersionId: versionId,
          expectedOpenCandidateRowVersion: detail.versions.items[0].rowVersion
        }
      })
    })

    expect(client.getQueryState(detailKey)).toBeUndefined()
    expectInvalidated(client, listKey)
    expectInvalidated(client, bookmarkKey)
    expectInvalidated(client, wrongKey)
    expectInvalidated(client, dashboardKey)
  })

  it('관리자 수정·삭제 실패 시 상세 set/remove와 교차 무효화를 실행하지 않는다', async () => {
    mockServer.use(...adminQuestionHandlers)
    mockDatabase.loginAs('ADMIN')
    const client = createTestClient()
    const missingQuestionId = '00000000-0000-4000-8000-ffffffffffff'
    const detailKey = adminQuestionQueries.detail(missingQuestionId).queryKey
    const listKey = adminQuestionQueries.list({
      page: 1,
      pageSize: 20,
      sort: 'UPDATED_DESC'
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
    const { input: validInput } =
      await prepareAdminQuestion('실패 테스트용 문제 문장')

    await expect(
      act(async () => {
        await updateHook.result.current.mutateAsync({
          questionId: missingQuestionId,
          versionId: missingQuestionId,
          input: validInput
        })
      })
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      act(async () => {
        await deleteHook.result.current.mutateAsync({
          questionId: missingQuestionId,
          input: {
            expectedQuestionRowVersion: 1,
            expectedOpenCandidateVersionId: null,
            expectedOpenCandidateRowVersion: null
          }
        })
      })
    ).rejects.toMatchObject({ status: 404 })

    expect(client.getQueryData(detailKey)).toEqual({ cached: true })
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(bookmarkKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(wrongKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(dashboardKey)?.isInvalidated).toBe(false)
  })
})
