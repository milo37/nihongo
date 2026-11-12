import { toContractDashboardStats } from '@mocks/adapters/dashboardContractAdapter'
import type {
  MockCanonicalDashboardRecord,
  MockCanonicalDashboardSessionRecord,
  MockCanonicalWrongNoteRecord
} from '@mocks/repository/mockDatabase'

const session = (
  id: string,
  level: MockCanonicalDashboardSessionRecord['level'],
  correctCount: number
): MockCanonicalDashboardSessionRecord => ({
  id: `019d0000-0000-7000-8000-00000000000${id}`,
  level,
  subject: 'GRAMMAR',
  mode: 'RANDOM',
  totalCount: 10,
  correctCount,
  durationSec: 60,
  submittedAt: `2026-11-0${id}T09:00:00.000Z`
})

// Only the level is read before the note is dropped by the filter.
const n3Note = {
  lastWrongQuestion: { level: 'N3' },
  status: 'AGAIN'
} as unknown as MockCanonicalWrongNoteRecord

const record: MockCanonicalDashboardRecord = {
  observedAt: '2026-11-07T12:00:00.000Z',
  sessions: [session('1', 'N2', 8), session('2', 'N3', 2)],
  wrongNotes: [n3Note]
}

describe('dashboard mock level filter (JLP-853)', () => {
  it('counts only the sessions and wrong notes of the asked level', () => {
    const stats = toContractDashboardStats(record, { level: 'N2' })
    expect(stats.totalAnsweredCount).toBe(10)
    expect(stats.correctRate).toBe(80)
    expect(stats.recentStudySessions.map(({ level }) => level)).toEqual(['N2'])
    expect(stats.wrongNoteCount).toBe(0)
    expect(stats.repeatedWrongQuestions).toEqual([])
  })

  it('counts every level without a level', () => {
    const stats = toContractDashboardStats({ ...record, wrongNotes: [] }, {})
    expect(stats.totalAnsweredCount).toBe(20)
    expect(stats.recentStudySessions).toHaveLength(2)
  })
})
