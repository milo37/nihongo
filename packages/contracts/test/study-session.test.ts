import { describe, expect, it } from 'vitest'
import {
  createStudySessionBodySchema,
  createStudySessionErrorSchema,
  createStudySessionResponseSchema
} from '../src/study/create-study-session.js'
import {
  getStudySessionParamsSchema,
  getStudySessionResponseSchema
} from '../src/study/get-study-session.js'

const ids = Array.from(
  { length: 12 },
  (_, index) =>
    `018f6b7a-1f4b-7d5e-8a91-4c27df9c10${index.toString(16).padStart(2, '0')}`
)

const question = {
  id: ids[2],
  questionVersionId: ids[3],
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  passage: null,
  questionText: '「川」の読み方はどれですか。',
  options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
    id: ids[4 + index],
    label: String(index + 1),
    text
  })),
  difficulty: 'EASY',
  tags: [{ id: ids[8], label: '한자 읽기' }]
}

const payload = {
  session: {
    id: ids[0],
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    status: 'IN_PROGRESS',
    requestedCount: 1,
    actualCount: 1,
    usedFallback: false,
    fallbackReason: null,
    startedAt: '2026-08-14T01:00:00.000Z',
    expiresAt: '2026-08-15T01:00:00.000Z',
    submittedAt: null,
    durationSec: null
  },
  questions: [{ sessionQuestionId: ids[1], ordinal: 1, question }]
}

describe('study session contracts', () => {
  it('strict create body와 UUID get params를 검증한다', () => {
    expect(
      createStudySessionBodySchema.parse({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 5
      })
    ).toEqual({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5
    })
    expect(getStudySessionParamsSchema.parse({ sessionId: ids[0] })).toEqual({
      sessionId: ids[0]
    })
    expect(
      createStudySessionBodySchema.safeParse({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 5,
        userId: ids[9]
      }).success
    ).toBe(false)
  })

  it('public explicit question ID와 count 경계를 거부한다', () => {
    expect(
      createStudySessionBodySchema.safeParse({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 0
      }).success
    ).toBe(false)
    expect(
      createStudySessionBodySchema.safeParse({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1,
        explicitQuestionIds: [ids[2]]
      }).success
    ).toBe(false)
  })

  it('create/get이 같은 canonical payload를 사용한다', () => {
    expect(createStudySessionResponseSchema.parse(payload)).toEqual(payload)
    expect(getStudySessionResponseSchema.parse(payload)).toEqual(payload)
    expect(
      createStudySessionResponseSchema.safeParse({
        ...payload,
        session: {
          ...payload.session,
          status: 'CANCELLED'
        }
      }).success
    ).toBe(false)
    expect(
      getStudySessionResponseSchema.safeParse({
        ...payload,
        session: {
          ...payload.session,
          status: 'CANCELLED'
        }
      }).success
    ).toBe(true)
  })

  it('count·ordinal·fallback metadata 불일치를 거부한다', () => {
    expect(
      createStudySessionResponseSchema.safeParse({
        ...payload,
        session: { ...payload.session, actualCount: 2 }
      }).success
    ).toBe(false)
    expect(
      createStudySessionResponseSchema.safeParse({
        ...payload,
        questions: [{ ...payload.questions[0], ordinal: 2 }]
      }).success
    ).toBe(false)
    expect(
      createStudySessionResponseSchema.safeParse({
        ...payload,
        session: {
          ...payload.session,
          usedFallback: true,
          fallbackReason: 'INSUFFICIENT_MODE_CANDIDATES'
        }
      }).success
    ).toBe(false)
    expect(
      createStudySessionResponseSchema.safeParse({
        ...payload,
        session: {
          ...payload.session,
          requestedCount: 2,
          actualCount: 1
        }
      }).success
    ).toBe(true)
  })

  it('제출 상태 metadata가 반쪽만 채워진 payload를 거부한다', () => {
    for (const partial of [
      { submittedAt: '2026-08-14T01:30:00.000Z', durationSec: null },
      { submittedAt: null, durationSec: 1_800 }
    ]) {
      expect(
        createStudySessionResponseSchema.safeParse({
          ...payload,
          session: { ...payload.session, ...partial }
        }).success
      ).toBe(false)
    }
  })

  it('owner·정답·해설·관리자 metadata 누출을 재귀적으로 거부한다', () => {
    const payloadQuestion = payload.questions[0]
    if (!payloadQuestion) {
      throw new Error('StudySession question fixture가 필요합니다.')
    }

    for (const leaked of [
      { userId: ids[9] },
      { guestPrincipalId: ids[10] },
      { correctOptionId: ids[4] },
      { explanationKo: '정답 해설' },
      { createdByUserId: ids[9] }
    ]) {
      expect(
        createStudySessionResponseSchema.safeParse({
          ...payload,
          session: { ...payload.session, ...leaked }
        }).success
      ).toBe(false)
      expect(
        createStudySessionResponseSchema.safeParse({
          ...payload,
          questions: [
            {
              ...payloadQuestion,
              question: { ...payloadQuestion.question, ...leaked }
            }
          ]
        }).success
      ).toBe(false)
    }
  })

  it('operation별 닫힌 오류 code를 강제한다', () => {
    expect(
      createStudySessionErrorSchema.safeParse({
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        requestId: ids[0],
        retryable: false
      }).success
    ).toBe(false)
  })
})
