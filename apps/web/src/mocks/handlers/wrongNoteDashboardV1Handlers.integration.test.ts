import {
  getDashboardStatsErrorSchema,
  getDashboardStatsResponseSchema
} from '@nihongo/contracts/dashboard/get-dashboard-stats'
import type { CreateStudySessionResponse } from '@nihongo/contracts/study/create-study-session'
import {
  getWrongNoteErrorSchema,
  getWrongNoteResponseSchema
} from '@nihongo/contracts/wrong-note/get-wrong-note'
import {
  listWrongNotesErrorSchema,
  listWrongNotesResponseSchema
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { describe, expect, it, vi } from 'vitest'
import { getDashboardStatsV1 } from '@api/dashboard/getDashboardStatsV1'
import { getWrongNoteV1 } from '@api/wrong-note/getWrongNoteV1'
import { listWrongNotesV1 } from '@api/wrong-note/listWrongNotesV1'
import { MOCK_DATABASE_STORAGE_KEY } from '@libs/storage'
import {
  getContractQuestionId,
  getQuestionVersionFingerprint,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import { mockCanonicalSubmissionOperations } from '@mocks/adapters/studySubmissionContractAdapter'
import { toContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import {
  MockDatabaseError,
  mockDatabase,
  type AdminQuestionInput
} from '@mocks/repository/mockDatabase'

const WRONG_NOTES_URL = 'http://localhost/api/v1/wrong-notes'
const DASHBOARD_URL = 'http://localhost/api/v1/dashboard'
const SOURCE_QUESTION_ID = 'n5-vocabulary-01'

type CanonicalQuestion = CreateStudySessionResponse['questions'][number]

const toAdminInput = (
  question: ReturnType<typeof mockDatabase.getAdminQuestion>,
  overrides: Partial<AdminQuestionInput> = {}
): AdminQuestionInput => {
  const correctOption = question.options.find(({ isCorrect }) => isCorrect)
  if (!correctOption) {
    throw new Error('admin input fixture의 정답 보기가 필요합니다.')
  }

  return {
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    passage: question.passage,
    questionText: question.questionText,
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
    status: question.status,
    ...overrides
  }
}

const createPinnedUserSession = (
  sourceQuestionId = SOURCE_QUESTION_ID
): CreateStudySessionResponse => {
  const { session } = mockDatabase.createStudySession({
    canonicalContractVersion: 1,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1,
    questionIds: [sourceQuestionId]
  })

  return toContractStudySessionPayload(
    mockDatabase.getCanonicalStudySessionSnapshotRecord(session.id, null)
  )
}

const getSelectedOptionId = (
  question: CanonicalQuestion,
  isCorrect: boolean
): string => {
  const source = mockDatabase.getAdminQuestion(SOURCE_QUESTION_ID)
  const optionIndex = source.options.findIndex(
    (option) => option.isCorrect === isCorrect
  )
  const option = question.question.options[optionIndex]
  if (!option) {
    throw new Error('canonical submit fixture의 선택지가 필요합니다.')
  }
  return option.id
}

const submitPinnedSession = (
  payload: CreateStudySessionResponse,
  isCorrect: boolean
) => {
  const question = payload.questions[0]
  if (!question) {
    throw new Error('canonical submit fixture의 문제가 필요합니다.')
  }

  return mockDatabase.submitCanonicalStudySession(
    {
      body: {
        answers: [
          {
            studySessionQuestionId: question.sessionQuestionId,
            selectedOptionId: getSelectedOptionId(question, isCorrect),
            elapsedSec: 3
          }
        ],
        durationSec: 3
      },
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId: payload.session.id
    },
    mockCanonicalSubmissionOperations
  ).response
}

const expectCanonicalHeaders = (response: Response): void => {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('X-Request-Id')).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  )
}

const createSolvedArchivedFixture = () => {
  mockDatabase.loginAs('USER')
  const wrongSession = createPinnedUserSession()
  const firstCorrectSession = createPinnedUserSession()
  const secondCorrectSession = createPinnedUserSession()
  const wrongResult = submitPinnedSession(wrongSession, false)
  const historicalQuestion = wrongResult.items[0]?.question
  if (!historicalQuestion) {
    throw new Error('historical wrong result question이 필요합니다.')
  }

  mockDatabase.loginAs('ADMIN')
  const current = mockDatabase.getAdminQuestion(SOURCE_QUESTION_ID)
  mockDatabase.updateQuestion(
    SOURCE_QUESTION_ID,
    toAdminInput(current, {
      questionText: `${current.questionText} current-only rename`,
      tags: ['current-only-tag'],
      status: 'DRAFT'
    })
  )
  mockDatabase.loginAs('USER')
  submitPinnedSession(firstCorrectSession, true)
  submitPinnedSession(secondCorrectSession, true)

  return { historicalQuestion, wrongResult }
}

describe('canonical wrong-note/dashboard v1 MSW integration', () => {
  it('endpoint adapters와 direct fetch가 historical SOLVED/read models, range, reload를 동일하게 투영한다', async () => {
    const { historicalQuestion } = createSolvedArchivedFixture()
    const questionId = getContractQuestionId(SOURCE_QUESTION_ID)

    const listResponse = await fetch(WRONG_NOTES_URL)
    const list = listWrongNotesResponseSchema.parse(await listResponse.json())
    expect(listResponse.status).toBe(200)
    expectCanonicalHeaders(listResponse)
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({
      questionId,
      wrongCount: 1,
      correctStreak: 2,
      status: 'SOLVED',
      reviewAvailability: 'ARCHIVED',
      hasMemo: false
    })

    const detailResponse = await fetch(`${WRONG_NOTES_URL}/${questionId}`)
    const detail = getWrongNoteResponseSchema.parse(await detailResponse.json())
    expect(detailResponse.status).toBe(200)
    expectCanonicalHeaders(detailResponse)
    expect(detail.question.questionText).toBe(historicalQuestion.questionText)
    expect(detail.question.options).toEqual(historicalQuestion.options)
    expect(detail.question.tags).toEqual(historicalQuestion.tags)
    expect(detail.question.questionVersionId).toBe(
      historicalQuestion.questionVersionId
    )
    expect(detail.lastWrongQuestionVersionId).toBe(
      historicalQuestion.questionVersionId
    )
    expect(detail.memo).toBeNull()

    const dashboardResponse = await fetch(DASHBOARD_URL)
    const dashboard = getDashboardStatsResponseSchema.parse(
      await dashboardResponse.json()
    )
    expect(dashboardResponse.status).toBe(200)
    expectCanonicalHeaders(dashboardResponse)
    expect(dashboard).toMatchObject({
      totalAnsweredCount: 3,
      correctCount: 2,
      correctRate: 66.67,
      wrongNoteCount: 1,
      solvedWrongNoteCount: 1,
      weakestSubject: 'VOCABULARY'
    })
    expect(dashboard.recentStudySessions).toHaveLength(3)
    expect(dashboard.repeatedWrongQuestions[0]).toMatchObject({
      questionId,
      wrongCount: 1,
      status: 'SOLVED'
    })

    const outsideRangeResponse = await fetch(
      `${DASHBOARD_URL}?from=2000-01-01&to=2000-01-01`
    )
    const outsideRange = getDashboardStatsResponseSchema.parse(
      await outsideRangeResponse.json()
    )
    expect(outsideRange.totalAnsweredCount).toBe(0)
    expect(outsideRange.recentStudySessions).toEqual([])
    expect(outsideRange.wrongNoteCount).toBe(1)
    expect(outsideRange.solvedWrongNoteCount).toBe(1)
    expect(outsideRange.repeatedWrongQuestions).toHaveLength(1)
    expect(outsideRange.dailyStudyCountLast7Days.at(-1)?.date).toBe(
      '2000-01-01'
    )

    expect(await listWrongNotesV1()).toEqual(list)
    expect(await getWrongNoteV1(questionId)).toEqual(detail)
    expect(await getDashboardStatsV1()).toEqual(dashboard)

    const legacyResponse = await fetch('http://localhost/api/wrong-note')
    const legacy = (await legacyResponse.json()) as { total?: unknown }
    expect(legacyResponse.status).toBe(200)
    expect(legacy.total).toBe(0)

    const persisted = window.localStorage.getItem(MOCK_DATABASE_STORAGE_KEY)
    if (!persisted) {
      throw new Error('canonical v3 reload fixture가 저장되어야 합니다.')
    }
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: MOCK_DATABASE_STORAGE_KEY,
        newValue: persisted
      })
    )
    const reloaded = listWrongNotesResponseSchema.parse(
      await (await fetch(WRONG_NOTES_URL)).json()
    )
    expect(reloaded).toEqual(list)
  })

  it('USER/ADMIN own-only와 guest 401, foreign/missing 동일 404를 지킨다', async () => {
    mockDatabase.loginAs('USER')
    const session = createPinnedUserSession()
    submitPinnedSession(session, false)
    const ownedId = getContractQuestionId(SOURCE_QUESTION_ID)

    mockDatabase.loginAs('ADMIN')
    const adminList = listWrongNotesResponseSchema.parse(
      await (await fetch(WRONG_NOTES_URL)).json()
    )
    expect(adminList.total).toBe(0)
    const foreignResponse = await fetch(`${WRONG_NOTES_URL}/${ownedId}`)
    const missingResponse = await fetch(
      `${WRONG_NOTES_URL}/018f6b7a-1f4b-7d5e-8a91-4c27df9c1999`
    )
    const foreign = getWrongNoteErrorSchema.parse(await foreignResponse.json())
    const missing = getWrongNoteErrorSchema.parse(await missingResponse.json())
    expect(foreignResponse.status).toBe(404)
    expect(missingResponse.status).toBe(404)
    expect({ ...foreign, requestId: undefined }).toEqual({
      ...missing,
      requestId: undefined
    })

    mockDatabase.logout()
    for (const url of [
      WRONG_NOTES_URL,
      `${WRONG_NOTES_URL}/${ownedId}`,
      DASHBOARD_URL
    ]) {
      const response = await fetch(url)
      expect(response.status).toBe(401)
      expectCanonicalHeaders(response)
    }
  })

  it('strict query/ID validation과 requestId/no-store safe500에서 내부 값을 숨긴다', async () => {
    mockDatabase.loginAs('USER')

    const invalidListResponse = await fetch(`${WRONG_NOTES_URL}?unknown=1`)
    const invalidList = listWrongNotesErrorSchema.parse(
      await invalidListResponse.json()
    )
    expect(invalidListResponse.status).toBe(422)
    expect(invalidList.code).toBe('VALIDATION_ERROR')
    expectCanonicalHeaders(invalidListResponse)
    expect(invalidListResponse.headers.get('X-Request-Id')).toBe(
      invalidList.requestId
    )

    const invalidRangeResponse = await fetch(`${DASHBOARD_URL}?from=2026-01-01`)
    const invalidRange = getDashboardStatsErrorSchema.parse(
      await invalidRangeResponse.json()
    )
    expect(invalidRangeResponse.status).toBe(422)
    expect(invalidRange.code).toBe('VALIDATION_ERROR')

    const invalidIdResponse = await fetch(`${WRONG_NOTES_URL}/not-a-uuid`)
    const invalidId = getWrongNoteErrorSchema.parse(
      await invalidIdResponse.json()
    )
    expect(invalidIdResponse.status).toBe(422)
    expect(invalidId.code).toBe('INVALID_ID')

    const secret = 'canonical-storage-secret-must-not-leak'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(
      mockDatabase,
      'listCanonicalWrongNoteRecords'
    ).mockImplementationOnce(() => {
      throw new MockDatabaseError('PERSISTENCE_FAILED', 500, secret)
    })
    const failedResponse = await fetch(WRONG_NOTES_URL)
    const failedText = await failedResponse.text()
    const failed = listWrongNotesErrorSchema.parse(JSON.parse(failedText))
    expect(failedResponse.status).toBe(500)
    expect(failed.code).toBe('INTERNAL_SERVER_ERROR')
    expect(failedText).not.toContain(secret)
    expect(failedText).not.toContain('sourceQuestionId')
    expectCanonicalHeaders(failedResponse)
    expect(failedResponse.headers.get('X-Request-Id')).toBe(failed.requestId)
  })

  it.each([
    { tags: [' secret-edge'] },
    { tags: ['secret-duplicate-tag', 'secret-duplicate-tag'] }
  ] as const)(
    'corrupt historical tags %j를 list/detail 모두 leakage 없는 500으로 닫는다',
    async ({ tags }) => {
      mockDatabase.loginAs('USER')
      submitPinnedSession(createPinnedUserSession(), false)
      const user = mockDatabase.getCurrentUser()
      if (!user) {
        throw new Error('canonical tag integrity USER가 필요합니다.')
      }
      const record = mockDatabase.listCanonicalWrongNoteRecords(user.id)[0]
      if (!record) {
        throw new Error('canonical tag integrity WrongNote가 필요합니다.')
      }
      const lastWrongQuestion = {
        ...record.lastWrongQuestion,
        tags: [...tags]
      }
      const corrupt = {
        ...record,
        lastWrongQuestion,
        lastWrongQuestionVersionId: toStableMockUuid(
          'question-version',
          `${record.sourceQuestionId}:${getQuestionVersionFingerprint(
            lastWrongQuestion
          )}`
        )
      }
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      vi.spyOn(
        mockDatabase,
        'listCanonicalWrongNoteRecords'
      ).mockReturnValueOnce([corrupt])
      const listResponse = await fetch(WRONG_NOTES_URL)
      const listText = await listResponse.text()
      expect(listResponse.status).toBe(500)
      expect(listText).not.toContain(tags[0]?.trim() ?? '')
      listWrongNotesErrorSchema.parse(JSON.parse(listText))

      vi.spyOn(mockDatabase, 'getCanonicalWrongNoteRecord').mockReturnValueOnce(
        corrupt
      )
      const detailResponse = await fetch(
        `${WRONG_NOTES_URL}/${getContractQuestionId(SOURCE_QUESTION_ID)}`
      )
      const detailText = await detailResponse.text()
      expect(detailResponse.status).toBe(500)
      expect(detailText).not.toContain(tags[0]?.trim() ?? '')
      getWrongNoteErrorSchema.parse(JSON.parse(detailText))
    }
  )
})
