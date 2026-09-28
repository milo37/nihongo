import { describe, expect, it } from 'vitest'
import { toContractDashboardInsights } from '@mocks/adapters/dashboardInsightsContractAdapter'
import { toStableMockUuid } from '@mocks/adapters/questionContractAdapter'
import type {
  MockCanonicalDashboardInsightAnswerRecord,
  MockCanonicalDashboardInsightsRecord
} from '@mocks/repository/mockDatabase'

const OBSERVED_AT = '2026-09-28T12:00:00.000Z'
const FROM_INCLUSIVE = '2026-06-30T12:00:00.000Z'

const id = (namespace: string, value: string): string =>
  toStableMockUuid(namespace, value)

const createEmptyRecord = (
  overrides: Partial<MockCanonicalDashboardInsightsRecord> = {}
): MockCanonicalDashboardInsightsRecord => ({
  answers: [],
  currentCatalog: [
    {
      level: 'N2',
      questionId: id('question', 'target'),
      questionText: '목표 급수 연습 문제',
      questionType: 'CONTEXT_VOCABULARY',
      subject: 'VOCABULARY'
    }
  ],
  observedAt: OBSERVED_AT,
  sessions: [],
  targetLevel: 'N2',
  wrongNotes: [],
  ...overrides
})

describe('toContractDashboardInsights', () => {
  it('표본이 없어도 목표 급수 fallback을 반환하고 null metric을 보존한다', () => {
    const response = toContractDashboardInsights(createEmptyRecord())

    expect(response.stats.overall).toEqual({
      attemptedCount: 0,
      correctCount: 0,
      correctRateBasisPoints: null,
      averageElapsedSec: null,
      lastAnsweredAt: null
    })
    expect(response.window.fromInclusive).toBe(FROM_INCLUSIVE)
    expect(response.personalizationFallbackReason).toBe(
      'NO_PERSONALIZED_EVIDENCE'
    )
    expect(response.recommendations).toEqual([
      expect.objectContaining({
        rank: 1,
        kind: 'TARGET_LEVEL_PRACTICE',
        action: expect.objectContaining({ level: 'N2', mode: 'RANDOM' })
      })
    ])
  })

  it('목표 급수가 없으면 실행 가능한 practice setup fallback만 반환한다', () => {
    const response = toContractDashboardInsights(
      createEmptyRecord({ currentCatalog: [], targetLevel: null })
    )

    expect(response.personalizationFallbackReason).toBe('TARGET_LEVEL_NOT_SET')
    expect(response.recommendations).toEqual([
      {
        rank: 1,
        kind: 'PRACTICE_SETUP',
        reason: { code: 'TARGET_LEVEL_NOT_SET' },
        action: { kind: 'OPEN_PRACTICE_SETUP' }
      }
    ])
  })

  it('정확한 90일 경계와 최신 tag label tie-break를 적용한다', () => {
    const questionId = id('question', 'boundary')
    const tagId = id('tag', 'boundary')
    const inWindowTimes = [
      FROM_INCLUSIVE,
      '2026-09-24T12:00:00.000Z',
      '2026-09-25T12:00:00.000Z',
      '2026-09-27T12:00:00.000Z',
      '2026-09-27T12:00:00.000Z'
    ] as const
    const answers = inWindowTimes.map(
      (answeredAt, index): MockCanonicalDashboardInsightAnswerRecord => ({
        answerId: id('answer', `boundary-${index}`),
        answeredAt,
        elapsedSec: 10 + index,
        isCorrect: index >= 2,
        level: 'N2',
        questionId,
        questionType: 'SENTENCE_ORDER',
        questionVersionId: id('version', `boundary-${index}`),
        sessionId: id('session', `boundary-${index}`),
        subject: 'GRAMMAR',
        tags: [{ tagId, tagLabel: `문장 배열 ${index}` }]
      })
    )
    const latestAnswers = answers
      .slice(-2)
      .toSorted(
        (left, right) =>
          left.questionVersionId.localeCompare(right.questionVersionId) ||
          left.answerId.localeCompare(right.answerId)
      )
    const expectedLatestLabel = latestAnswers[0]?.tags[0]?.tagLabel
    const excludedAnswer: MockCanonicalDashboardInsightAnswerRecord = {
      ...answers[0]!,
      answerId: id('answer', 'outside-window'),
      answeredAt: '2026-06-30T11:59:59.999Z',
      questionVersionId: id('version', 'outside-window'),
      sessionId: id('session', 'outside-window'),
      tags: [{ tagId, tagLabel: '분석 범위 밖 label' }]
    }
    const allAnswers = [excludedAnswer, ...answers]
    const response = toContractDashboardInsights(
      createEmptyRecord({
        answers: allAnswers,
        currentCatalog: [
          {
            level: 'N2',
            questionId,
            questionText: '문장을 올바른 순서로 배열하세요.',
            questionType: 'SENTENCE_ORDER',
            subject: 'GRAMMAR'
          }
        ],
        sessions: allAnswers.map((answer) => ({
          id: answer.sessionId,
          level: answer.level,
          questionIds: [answer.questionId],
          subject: answer.subject,
          submittedAt: answer.answeredAt
        }))
      })
    )

    expect(response.stats.overall).toMatchObject({
      attemptedCount: 5,
      correctCount: 3,
      correctRateBasisPoints: 6_000,
      averageElapsedSec: 12
    })
    expect(response.stats.byTag).toEqual([
      expect.objectContaining({ tagId, tagLabel: expectedLatestLabel })
    ])
    expect(response.weaknesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'QUESTION_TYPE|N2|GRAMMAR|SENTENCE_ORDER',
          attemptedCount: 5,
          incorrectCount: 2
        })
      ])
    )
    expect(response.recommendations[0]).toMatchObject({
      kind: 'RECENT_LOW_ACCURACY_TYPE',
      action: { level: 'N2', subject: 'GRAMMAR', mode: 'WEAKNESS' }
    })
  })

  it('global top 10 밖의 actionable 비태그 약점도 추천 근거로 응답에 보존한다', () => {
    const highQuestionId = id('question', 'high-unavailable')
    const lowQuestionId = id('question', 'low-actionable')
    const highTags = Array.from({ length: 10 }, (_, index) => ({
      tagId: id('tag', `high-${index}`),
      tagLabel: `고득점 태그 ${index}`
    }))
    const highAnswers = Array.from(
      { length: 5 },
      (_, index): MockCanonicalDashboardInsightAnswerRecord => ({
        answerId: id('answer', `high-${index}`),
        answeredAt: `2026-09-2${index + 1}T12:00:00.000Z`,
        elapsedSec: 5,
        isCorrect: false,
        level: 'N1',
        questionId: highQuestionId,
        questionType: 'GRAMMAR_SELECT',
        questionVersionId: id('version', 'high'),
        sessionId: id('session', `high-${index}`),
        subject: 'GRAMMAR',
        tags: highTags
      })
    )
    const lowAnswers = Array.from(
      { length: 5 },
      (_, index): MockCanonicalDashboardInsightAnswerRecord => ({
        answerId: id('answer', `low-${index}`),
        answeredAt: `2026-09-1${index + 1}T12:00:00.000Z`,
        elapsedSec: 8,
        isCorrect: index >= 2,
        level: 'N2',
        questionId: lowQuestionId,
        questionType: 'SENTENCE_ORDER',
        questionVersionId: id('version', 'low'),
        sessionId: id('session', `low-${index}`),
        subject: 'GRAMMAR',
        tags: []
      })
    )
    const answers = [...highAnswers, ...lowAnswers]
    const response = toContractDashboardInsights(
      createEmptyRecord({
        answers,
        currentCatalog: [
          {
            level: 'N2',
            questionId: lowQuestionId,
            questionText: '현재 공개된 문장 배열 문제',
            questionType: 'SENTENCE_ORDER',
            subject: 'GRAMMAR'
          }
        ],
        sessions: answers.map((answer) => ({
          id: answer.sessionId,
          level: answer.level,
          questionIds: [answer.questionId],
          subject: answer.subject,
          submittedAt: answer.answeredAt
        }))
      })
    )
    const recommendation = response.recommendations.find(
      (item) => item.kind === 'RECENT_LOW_ACCURACY_TYPE'
    )

    expect(response.weaknesses).toHaveLength(10)
    expect(recommendation).toMatchObject({
      kind: 'RECENT_LOW_ACCURACY_TYPE',
      reason: { questionType: 'SENTENCE_ORDER' },
      action: { level: 'N2', subject: 'GRAMMAR' }
    })
    expect(response.weaknesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'QUESTION_TYPE|N2|GRAMMAR|SENTENCE_ORDER'
        })
      ])
    )
  })
})
