import { describe, expect, it } from 'vitest'
import {
  getStudyResultErrorSchema,
  getStudyResultParamsSchema,
  getStudyResultResponseSchema
} from '../src/study/get-study-result.js'
import {
  duplicateAnswerValidationMarker,
  submitStudySessionBodySchema,
  submitStudySessionErrorCodeSchema,
  submitStudySessionErrorSchema,
  submitStudySessionHeadersSchema,
  submitStudySessionParamsSchema,
  submitStudySessionResponseSchema,
  submitStudySessionV2BodySchema,
  submitStudySessionV2ErrorCodeSchema,
  submitStudySessionV2HeadersSchema
} from '../src/study/submit-study-session.js'

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const createReviewedQuestion = (index: number) => ({
  id: id(index),
  questionVersionId: id(index + 1),
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  passage: null,
  questionText: `문제 ${index}`,
  options: Array.from({ length: 4 }, (_, optionIndex) => ({
    id: id(index + 2 + optionIndex),
    label: String(optionIndex + 1),
    text: `보기 ${optionIndex + 1}`
  })),
  difficulty: 'EASY',
  tags: [{ id: id(index + 6), label: '한자 읽기' }],
  correctOptionId: id(index + 2),
  explanationKo: '한국어 해설',
  explanationJa: null
})

const firstQuestion = createReviewedQuestion(10)
const secondQuestion = createReviewedQuestion(30)

const result = {
  sessionId: id(1),
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  totalCount: 2,
  correctCount: 1,
  incorrectCount: 1,
  correctRate: 50,
  durationSec: 30,
  submittedAt: '2026-08-15T10:00:00+09:00',
  items: [
    {
      sessionQuestionId: id(2),
      question: firstQuestion,
      selectedOptionId: firstQuestion.correctOptionId,
      isCorrect: true,
      wrongNoteStatus: 'SOLVED'
    },
    {
      sessionQuestionId: id(3),
      question: secondQuestion,
      selectedOptionId: null,
      isCorrect: false,
      wrongNoteStatus: 'NEW'
    }
  ]
}

const body = {
  answers: [
    {
      studySessionQuestionId: id(2),
      selectedOptionId: firstQuestion.correctOptionId,
      elapsedSec: 10
    },
    {
      studySessionQuestionId: id(3),
      selectedOptionId: null,
      elapsedSec: 20
    }
  ],
  durationSec: 30
}

describe('study submit/result contracts', () => {
  it('UUID params·lower-case idempotency header·strict body를 검증한다', () => {
    expect(
      submitStudySessionParamsSchema.parse({ sessionId: id(1).toUpperCase() })
    ).toEqual({ sessionId: id(1) })
    expect(
      submitStudySessionHeadersSchema.parse({
        'idempotency-key': id(99).toUpperCase()
      })
    ).toEqual({ 'idempotency-key': id(99) })
    expect(
      submitStudySessionBodySchema.parse({
        ...body,
        answers: body.answers.map((answer) => ({
          ...answer,
          studySessionQuestionId: answer.studySessionQuestionId.toUpperCase(),
          selectedOptionId: answer.selectedOptionId?.toUpperCase() ?? null
        }))
      })
    ).toEqual(body)

    for (const invalid of [
      {},
      { 'Idempotency-Key': id(99) },
      { 'idempotency-key': 'not-a-uuid' }
    ]) {
      expect(submitStudySessionHeadersSchema.safeParse(invalid).success).toBe(
        false
      )
    }

    expect(
      submitStudySessionBodySchema.safeParse({ ...body, isCorrect: true })
        .success
    ).toBe(false)
    expect(
      submitStudySessionBodySchema.safeParse({
        ...body,
        answers: [{ ...body.answers[0], questionId: id(10) }]
      }).success
    ).toBe(false)

    expect(
      submitStudySessionBodySchema.safeParse({
        ...body,
        expectedDraftRevision: 0
      }).success
    ).toBe(false)
  })

  it('v2 header와 draft revision을 v1과 분리한다', () => {
    expect(
      submitStudySessionV2HeadersSchema.parse({
        'idempotency-key': id(99),
        'x-nihongo-practice-contract': '2'
      })
    ).toEqual({
      'idempotency-key': id(99),
      'x-nihongo-practice-contract': '2'
    })
    expect(
      submitStudySessionV2HeadersSchema.safeParse({
        'idempotency-key': id(99)
      }).success
    ).toBe(false)
    expect(
      submitStudySessionHeadersSchema.safeParse({
        'idempotency-key': id(99),
        'x-nihongo-practice-contract': '2'
      }).success
    ).toBe(false)
    expect(
      submitStudySessionV2BodySchema.parse({
        ...body,
        expectedDraftRevision: 0
      }).expectedDraftRevision
    ).toBe(0)
    expect(
      submitStudySessionV2BodySchema.safeParse({
        ...body,
        expectedDraftRevision: -1
      }).success
    ).toBe(false)
    expect(
      submitStudySessionV2BodySchema.safeParse({
        ...body,
        expectedDraftRevision: Number.MAX_SAFE_INTEGER + 1
      }).success
    ).toBe(false)

    expect(submitStudySessionV2ErrorCodeSchema.options).toEqual([
      ...submitStudySessionErrorCodeSchema.options,
      'DRAFT_VERSION_CONFLICT',
      'DRAFT_SUBMIT_MISMATCH'
    ])
  })

  it('답안 중복을 식별 가능한 marker로 거부한다', () => {
    const firstAnswer = body.answers[0]
    if (!firstAnswer) {
      throw new Error('첫 번째 answer fixture가 필요합니다.')
    }
    const parsed = submitStudySessionBodySchema.safeParse({
      ...body,
      answers: [
        firstAnswer,
        {
          ...firstAnswer,
          studySessionQuestionId:
            firstAnswer.studySessionQuestionId.toUpperCase()
        }
      ]
    })

    expect(parsed.success).toBe(false)
    if (parsed.success) {
      throw new Error('중복 답안은 거부되어야 합니다.')
    }

    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        code: 'custom',
        path: ['answers', 1, 'studySessionQuestionId'],
        params: { contractCode: duplicateAnswerValidationMarker }
      })
    )
  })

  it('elapsedSec와 durationSec 경계를 고정한다', () => {
    expect(
      submitStudySessionBodySchema.safeParse({
        ...body,
        answers: [{ ...body.answers[0], elapsedSec: 86_401 }]
      }).success
    ).toBe(false)
    expect(
      submitStudySessionBodySchema.safeParse({
        ...body,
        durationSec: 604_801
      }).success
    ).toBe(false)
    expect(
      submitStudySessionBodySchema.safeParse({
        answers: [
          { ...body.answers[0], elapsedSec: 86_400 },
          { ...body.answers[1], elapsedSec: 0 }
        ],
        durationSec: 604_800
      }).success
    ).toBe(true)
  })

  it('submit/get이 동일한 canonical StudyResult를 사용한다', () => {
    const submitted = submitStudySessionResponseSchema.parse(result)
    const fetched = getStudyResultResponseSchema.parse(result)

    expect(submitted).toEqual(fetched)
    expect(submitted.submittedAt).toBe('2026-08-15T01:00:00.000Z')
    expect(
      getStudyResultParamsSchema.parse({ sessionId: result.sessionId })
    ).toEqual({ sessionId: result.sessionId })
  })

  it('고정 version 정답·선택 보기·채점·오답 상태의 일치를 강제한다', () => {
    const firstItem = result.items[0]
    if (!firstItem) {
      throw new Error('첫 번째 result item fixture가 필요합니다.')
    }

    for (const invalidItem of [
      {
        ...firstItem,
        question: { ...firstItem.question, correctOptionId: id(500) }
      },
      { ...firstItem, selectedOptionId: id(500) },
      { ...firstItem, isCorrect: false },
      { ...firstItem, wrongNoteStatus: 'NEW' }
    ]) {
      expect(
        submitStudySessionResponseSchema.safeParse({
          ...result,
          items: [invalidItem, result.items[1]]
        }).success
      ).toBe(false)
    }
  })

  it('count·basis points 정답률·item 고유성 불일치를 거부한다', () => {
    for (const invalid of [
      { ...result, correctCount: 2, incorrectCount: 0, correctRate: 100 },
      { ...result, correctRate: 49.99 },
      { ...result, totalCount: 1 },
      { ...result, items: [result.items[0], result.items[0]] }
    ]) {
      expect(submitStudySessionResponseSchema.safeParse(invalid).success).toBe(
        false
      )
    }
  })

  it('ReviewedQuestion 외 위치의 정답·owner·admin metadata를 거부한다', () => {
    const firstItem = result.items[0]
    if (!firstItem) {
      throw new Error('첫 번째 result item fixture가 필요합니다.')
    }

    for (const leaked of [
      { ...result, userId: id(80) },
      {
        ...result,
        items: [{ ...firstItem, correctOptionId: id(12) }, result.items[1]]
      },
      {
        ...result,
        items: [
          {
            ...firstItem,
            question: { ...firstItem.question, createdByUserId: id(81) }
          },
          result.items[1]
        ]
      }
    ]) {
      expect(submitStudySessionResponseSchema.safeParse(leaked).success).toBe(
        false
      )
    }
  })

  it('operation별 닫힌 오류 code를 강제한다', () => {
    const failure = {
      message: '요청을 처리할 수 없습니다.',
      requestId: id(90),
      retryable: false
    }

    expect(
      submitStudySessionErrorSchema.safeParse({
        ...failure,
        code: 'DUPLICATE_ANSWER'
      }).success
    ).toBe(true)
    expect(
      submitStudySessionErrorSchema.safeParse({
        ...failure,
        code: 'STUDY_RESULT_NOT_READY'
      }).success
    ).toBe(false)
    expect(
      getStudyResultErrorSchema.safeParse({
        ...failure,
        code: 'STUDY_RESULT_NOT_READY'
      }).success
    ).toBe(true)
    expect(
      getStudyResultErrorSchema.safeParse({
        ...failure,
        code: 'DUPLICATE_ANSWER'
      }).success
    ).toBe(false)
  })
})
