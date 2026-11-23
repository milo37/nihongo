import { selectRandomStudyCandidates } from '@mocks/adapters/studyCandidateSelection'

const pin = (id: string, lastSeenAt: string | null) => ({
  questionId: id,
  questionVersionId: `${id}-v1`,
  lastSeenAt: lastSeenAt === null ? null : new Date(lastSeenAt)
})

describe('mock random selection (#1242, same rule as the server)', () => {
  it('serves never-seen questions first, then the ones seen longest ago', () => {
    const candidates = [
      pin('seen-new', '2026-11-22T00:00:00Z'),
      pin('unseen-a', null),
      pin('seen-old', '2026-11-01T00:00:00Z'),
      pin('unseen-b', null),
      pin('seen-mid', '2026-11-10T00:00:00Z')
    ]
    const picked = selectRandomStudyCandidates(candidates, 4, Math.random).map(
      ({ questionId }) => questionId
    )
    expect(new Set(picked.slice(0, 2))).toEqual(
      new Set(['unseen-a', 'unseen-b'])
    )
    expect(picked.slice(2)).toEqual(['seen-old', 'seen-mid'])
  })
})
