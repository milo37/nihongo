import { describe, expect, it } from 'vitest'
import { getDashboardStatsV1 } from '@api/dashboard/getDashboardStatsV1'
import { getWrongNoteV1 } from '@api/wrong-note/getWrongNoteV1'
import { listWrongNotesV1 } from '@api/wrong-note/listWrongNotesV1'
import {
  getContractQuestionId,
  getSourceQuestionId
} from '@mocks/adapters/questionContractAdapter'
import { mockCanonicalSubmissionOperations } from '@mocks/adapters/studySubmissionContractAdapter'
import { toContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const SOURCE_QUESTION_ID = 'n5-vocabulary-01'

const createCanonicalWrongNote = (): void => {
  mockDatabase.loginAs('USER')
  const { session } = mockDatabase.createStudySession({
    canonicalContractVersion: 1,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1,
    questionIds: [SOURCE_QUESTION_ID]
  })
  const payload = toContractStudySessionPayload(
    mockDatabase.getCanonicalStudySessionSnapshotRecord(session.id, null)
  )
  const question = payload.questions[0]
  const sourceQuestionId = question
    ? getSourceQuestionId(
        question.question.id,
        mockDatabase.listAdminQuestions({ pageSize: 100 }).items
      )
    : undefined
  const source = sourceQuestionId
    ? mockDatabase.getAdminQuestion(sourceQuestionId)
    : undefined
  const wrongIndex = source?.options.findIndex(({ isCorrect }) => !isCorrect)
  const selectedOption =
    wrongIndex === undefined
      ? undefined
      : question?.question.options[wrongIndex]
  if (!question || !source || !selectedOption) {
    throw new Error('learning-read endpoint fixture가 필요합니다.')
  }

  mockDatabase.submitCanonicalStudySession(
    {
      body: {
        answers: [
          {
            studySessionQuestionId: question.sessionQuestionId,
            selectedOptionId: selectedOption.id,
            elapsedSec: 2
          }
        ],
        durationSec: 2
      },
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId: session.id
    },
    mockCanonicalSubmissionOperations
  )
}

describe('canonical learning-read endpoint adapters', () => {
  it('shared request/response contracts를 거친 wrong-note list/detail/dashboard를 반환한다', async () => {
    createCanonicalWrongNote()
    const questionId = getContractQuestionId(SOURCE_QUESTION_ID)

    const list = await listWrongNotesV1({
      status: 'NEW',
      sort: 'MOST_WRONG',
      page: 1,
      pageSize: 10
    })
    const detail = await getWrongNoteV1(questionId)
    const dashboard = await getDashboardStatsV1()

    expect(list.items).toHaveLength(1)
    expect(list.items[0]?.questionId).toBe(questionId)
    expect(detail.wrongNote).toEqual(list.items[0])
    expect(detail.lastWrongQuestionVersionId).toBe(
      detail.question.questionVersionId
    )
    expect(dashboard).toMatchObject({
      totalAnsweredCount: 1,
      correctCount: 0,
      wrongNoteCount: 1,
      solvedWrongNoteCount: 0
    })
  })

  it('invalid params는 safeGet 이전 shared request parser에서 동기 거부한다', () => {
    expect(() => listWrongNotesV1({ page: 0 })).toThrow()
    expect(() => getWrongNoteV1('not-a-uuid')).toThrow()
    expect(() => getDashboardStatsV1({ from: '2026-08-16' })).toThrow()
  })
})
