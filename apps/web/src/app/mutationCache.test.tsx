import * as phase7AdminApi from '@api/phase7/phase7AdminApi'
import { updateQuestionVersionRequestSchema } from '@nihongo/contracts/admin/phase7'
import { useUpdatePhase7AdminQuestionVersion } from '@app/admin-question/hooks/usePhase7AdminMutations'
import {
  adminQuestionKeys,
  adminQuestionVersionKeys,
  adminAuditLogKeys,
  phase7AdminQueries
} from '@app/admin-question/queries/phase7AdminQueries'
import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { authQueries } from '@app/login/queries/authQueries'
import { commitCanonicalAuth } from '@app/login/authSession'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import {
  QueryClient,
  QueryClientProvider,
  useQuery
} from '@tanstack/react-query'
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
    const admin = mockDatabase.loginAs('ADMIN')
    useAppStore.getState().setCurrentUser(admin)
    const source = toUpdateInput('n5-vocabulary-01', '캐시 검증용 관리자 초안')
    const created = await phase7AdminApi.createPhase7AdminQuestion({
      level: source.level,
      subject: source.subject,
      questionType: source.questionType,
      difficulty: source.difficulty,
      questionText: source.questionText,
      passage: source.passage,
      explanationKo: source.explanationKo,
      explanationJa: source.explanationJa,
      tagNames: source.tags,
      options: source.options.map(({ label, text }) => ({
        clientOptionKey: label,
        text
      })),
      correctOptionKey: '1'
    })
    if (!created.questionVersionId)
      throw new Error('편집 버전 fixture가 필요합니다.')
    const questionId = created.questionId
    const versionId = created.questionVersionId
    const detail = await phase7AdminApi.getPhase7AdminQuestion(questionId)
    const version = detail.versions.items.find(
      (item) => item.questionVersionId === versionId
    )
    if (!version) throw new Error('현재 rowVersion fixture가 필요합니다.')
    const client = createTestClient()
    const preview = await client.fetchQuery(
      phase7AdminQueries.preview(versionId)
    )
    const questionText = '수정된 관리자 문제 문장'
    const body = updateQuestionVersionRequestSchema.parse({
      level: preview.question.level,
      subject: preview.question.subject,
      questionType: preview.question.questionType,
      difficulty: preview.question.difficulty,
      passage: preview.question.passage,
      questionText,
      explanationKo: preview.adminAnswer.explanationKo,
      explanationJa: preview.adminAnswer.explanationJa,
      tagNames: preview.question.tags.map((tag) => tag.label),
      options: preview.question.options.map(({ id, label, text }) => ({
        id,
        ordinal: Number(label),
        text
      })),
      correctOptionId: preview.adminAnswer.correctOptionId,
      expectedRowVersion: version.rowVersion
    })
    const updateApi = vi.spyOn(phase7AdminApi, 'updatePhase7QuestionVersion')
    const detailKey = adminQuestionKeys.detail(questionId)
    const historyKey = [
      ...adminQuestionVersionKeys.historyFamily(questionId),
      'seed'
    ] as const
    const diffKey = [
      ...adminQuestionVersionKeys.diffFamily(versionId),
      'seed'
    ] as const
    const listKey = [...adminQuestionKeys.allLists(), 'seed'] as const
    const auditKey = [...adminAuditLogKeys.allLists(), 'seed'] as const
    const bookmarkKey = [...bookmarkQueries.allKey(), 'seed'] as const
    const wrongKey = [...wrongNoteQueries.allKey(), 'seed'] as const
    const dashboardKey = [...dashboardQueries.allKey(), 'seed'] as const
    client.setQueryData(detailKey, detail)
    for (const key of [
      historyKey,
      diffKey,
      listKey,
      auditKey,
      bookmarkKey,
      wrongKey,
      dashboardKey
    ])
      seedCache(client, key)
    const { result } = renderHook(
      () => ({
        preview: useQuery(phase7AdminQueries.preview(versionId)),
        update: useUpdatePhase7AdminQuestionVersion(questionId, versionId)
      }),
      { wrapper: createWrapper(client) }
    )
    await waitFor(() => expect(result.current.preview.isSuccess).toBe(true))
    await act(async () => {
      await result.current.update.mutateAsync(body)
    })
    expect(updateApi).toHaveBeenCalledExactlyOnceWith(versionId, body)
    expect(
      client.getQueryData(phase7AdminQueries.preview(versionId).queryKey)
        ?.question.questionText
    ).toBe(questionText)
    for (const key of [detailKey, historyKey, diffKey, listKey, auditKey])
      expectInvalidated(client, key)
    // A content edit affects admin caches. Learner caches change only on publication.
    for (const key of [bookmarkKey, wrongKey, dashboardKey])
      expect(client.getQueryState(key)?.isInvalidated).toBe(false)
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
