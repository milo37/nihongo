import { getDashboardStatsQuerySchema } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { listWrongNotesQuerySchema } from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { describe, expect, it } from 'vitest'
import {
  MockDashboardIntegrityError,
  toContractDashboardStats
} from '@mocks/adapters/dashboardContractAdapter'
import {
  getQuestionVersionFingerprint,
  toContractPracticeQuestion,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import {
  MockWrongNoteReadIntegrityError,
  toContractWrongNoteDetail,
  toContractWrongNoteList
} from '@mocks/adapters/wrongNoteReadContractAdapter'
import { originalQuestions } from '@mocks/data/questions'
import type {
  MockCanonicalDashboardRecord,
  MockCanonicalDashboardSessionRecord,
  MockCanonicalWrongNoteRecord
} from '@mocks/repository/mockDatabase'
import { toPracticeQuestion } from '@util/question'

const sourceQuestion = originalQuestions[0]
if (!sourceQuestion) {
  throw new Error('canonical learning-read adapter fixture가 필요합니다.')
}

const versionFingerprint = getQuestionVersionFingerprint(sourceQuestion)
const versionId = toStableMockUuid(
  'question-version',
  `${sourceQuestion.id}:${versionFingerprint}`
)
const baseWrongNote = {
  wrongNoteId: `wrong-note-user-${sourceQuestion.id}`,
  userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001',
  sourceQuestionId: sourceQuestion.id,
  wrongCount: 2,
  correctStreak: 2,
  status: 'SOLVED',
  lastWrongAt: '2026-08-10T00:00:00.000Z',
  lastReviewedAt: '2026-08-12T00:00:00.000Z',
  nextReviewAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  lastWrongQuestion: structuredClone(sourceQuestion),
  lastWrongQuestionVersionId: versionId,
  isCurrentPublished: false
} satisfies MockCanonicalWrongNoteRecord

const withHistoricalTags = (
  tags: readonly string[]
): MockCanonicalWrongNoteRecord => {
  const lastWrongQuestion = {
    ...baseWrongNote.lastWrongQuestion,
    tags: [...tags]
  }
  return {
    ...baseWrongNote,
    lastWrongQuestion,
    lastWrongQuestionVersionId: toStableMockUuid(
      'question-version',
      `${baseWrongNote.sourceQuestionId}:${getQuestionVersionFingerprint(
        lastWrongQuestion
      )}`
    )
  }
}

const session = (
  id: string,
  submittedAt: string,
  overrides: Partial<MockCanonicalDashboardSessionRecord> = {}
): MockCanonicalDashboardSessionRecord => ({
  id: toStableMockUuid('dashboard-session', id),
  level: 'N5',
  subject: 'VOCABULARY',
  totalCount: 3,
  correctCount: 1,
  durationSec: 9,
  submittedAt,
  ...overrides
})

describe('canonical learning-read contract adapters', () => {
  it('historical detail이 result와 동일한 pinned option/tag IDs를 유지한다', () => {
    const detail = toContractWrongNoteDetail(baseWrongNote)
    const resultQuestion = toContractPracticeQuestion(
      toPracticeQuestion(sourceQuestion),
      versionFingerprint
    )

    expect(detail.question.options).toEqual(resultQuestion.options)
    expect(detail.question.tags).toEqual(resultQuestion.tags)
    expect(detail.question.questionVersionId).toBe(
      resultQuestion.questionVersionId
    )
    expect(detail.lastWrongQuestionVersionId).toBe(versionId)
    expect(detail.currentReviewQuestionVersionId).toBeNull()
    expect(detail.memo).toBeNull()
    expect(detail.wrongNote.reviewAvailability).toBe('ARCHIVED')
  })

  it('tag exact 문자열을 보존하고 ASCII edge/duplicate/canonical-ID 충돌은 fail closed한다', () => {
    const exactRecord = withHistoricalTags(['Tag', 'Tag  Variant'])
    const list = toContractWrongNoteList(
      [exactRecord],
      listWrongNotesQuerySchema.parse({ tag: 'Tag  Variant' })
    )
    expect(list.availableTags).toEqual(['Tag', 'Tag  Variant'])
    expect(list.items[0]?.tags).toEqual(['Tag', 'Tag  Variant'])
    const repeatedAcrossNotes = toContractWrongNoteList(
      [
        exactRecord,
        {
          ...exactRecord,
          wrongNoteId: 'second-note',
          sourceQuestionId: `${exactRecord.sourceQuestionId}-second`
        }
      ],
      listWrongNotesQuerySchema.parse({})
    )
    expect(repeatedAcrossNotes.total).toBe(2)
    expect(repeatedAcrossNotes.availableTags).toEqual(['Tag', 'Tag  Variant'])

    for (const tags of [[' Tag'], ['Tag', 'Tag']] as const) {
      const corrupt = withHistoricalTags(tags)
      expect(() =>
        toContractWrongNoteList([corrupt], listWrongNotesQuerySchema.parse({}))
      ).toThrow(MockWrongNoteReadIntegrityError)
      expect(() => toContractWrongNoteDetail(corrupt)).toThrow(
        MockWrongNoteReadIntegrityError
      )
    }

    const normalizedCollision = withHistoricalTags(['Tag', 'tag'])
    expect(() => toContractWrongNoteDetail(normalizedCollision)).toThrow(
      MockWrongNoteReadIntegrityError
    )
  })

  it('pagination offset을 BigInt로 계산해 큰 page도 안전하게 빈 결과를 낸다', () => {
    const result = toContractWrongNoteList(
      [baseWrongNote],
      listWrongNotesQuerySchema.parse({
        page: Number.MAX_SAFE_INTEGER,
        pageSize: 100
      })
    )

    expect(result.items).toEqual([])
    expect(result.total).toBe(1)
  })

  it('UTC offset instant로 anchor/range/recent chronology를 계산하고 note 집계는 all-time으로 둔다', () => {
    const record = {
      observedAt: '2026-08-17T00:30:00+09:00',
      sessions: [
        session('earlier', '2026-08-17T08:00:00+09:00'),
        session('later', '2026-08-16T17:00:00-07:00')
      ],
      wrongNotes: [baseWrongNote]
    } satisfies MockCanonicalDashboardRecord
    const full = toContractDashboardStats(
      record,
      getDashboardStatsQuerySchema.parse({})
    )

    expect(full.dailyStudyCountLast7Days.at(-1)?.date).toBe('2026-08-16')
    expect(full.dailyStudyCountLast7Days.at(-1)?.count).toBe(3)
    expect(full.recentStudySessions.map(({ id }) => id)).toEqual([
      record.sessions[1]?.id,
      record.sessions[0]?.id
    ])

    const range = toContractDashboardStats(
      record,
      getDashboardStatsQuerySchema.parse({
        from: '2026-08-16',
        to: '2026-08-16'
      })
    )
    expect(range.totalAnsweredCount).toBe(3)
    expect(range.wrongNoteCount).toBe(1)
    expect(range.solvedWrongNoteCount).toBe(1)
    expect(range.repeatedWrongQuestions).toHaveLength(1)
  })

  it('basis-point half-up와 최소 3문항 subject tie를 고정하고 invalid instant를 거부한다', () => {
    const tied = {
      observedAt: '2026-08-16T12:00:00.000Z',
      sessions: [
        session('vocabulary', '2026-08-16T10:00:00.000Z'),
        session('grammar', '2026-08-16T11:00:00.000Z', {
          subject: 'GRAMMAR'
        })
      ],
      wrongNotes: []
    } satisfies MockCanonicalDashboardRecord
    const dashboard = toContractDashboardStats(
      tied,
      getDashboardStatsQuerySchema.parse({})
    )
    expect(dashboard.correctRate).toBe(33.33)
    expect(dashboard.weakestSubject).toBe('VOCABULARY')
    expect(dashboard.subjectStats.map(({ subject }) => subject)).toEqual([
      'VOCABULARY',
      'GRAMMAR',
      'READING'
    ])

    for (const observedAt of ['not-an-instant', '2026-08-16']) {
      expect(() =>
        toContractDashboardStats(
          { ...tied, observedAt },
          getDashboardStatsQuerySchema.parse({})
        )
      ).toThrow(MockDashboardIntegrityError)
    }
  })
})
