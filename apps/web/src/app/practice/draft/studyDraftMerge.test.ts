import { describe, expect, it } from 'vitest'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import {
  applyStudyDraftDiff,
  diffStudyDraftSnapshots,
  mergeStudyDraftSnapshots
} from '@app/practice/draft/studyDraftMerge'

const sessionId = '00000000-0000-4000-8000-000000000001'
const firstQuestionId = '00000000-0000-4000-8000-000000000002'
const secondQuestionId = '00000000-0000-4000-8000-000000000003'
const firstOptionId = '00000000-0000-4000-8000-000000000004'
const secondOptionId = '00000000-0000-4000-8000-000000000005'
const thirdQuestionId = '00000000-0000-4000-8000-000000000006'

const createSnapshot = (): StudyDraftSnapshot => ({
  answers: [
    {
      elapsedSec: 2,
      selectedOptionId: null,
      studySessionQuestionId: firstQuestionId
    },
    {
      elapsedSec: 4,
      selectedOptionId: null,
      studySessionQuestionId: secondQuestionId
    }
  ],
  currentOrdinal: 1,
  revision: 1,
  savedAt: '2026-08-18T00:00:00.000Z',
  studySessionId: sessionId
})

describe('study draft three-way merge', () => {
  it('auto-merges independent local and remote changes without data loss', () => {
    const base = createSnapshot()
    const local = {
      ...base,
      answers: base.answers.map((answer) =>
        answer.studySessionQuestionId === firstQuestionId
          ? { ...answer, selectedOptionId: firstOptionId }
          : answer
      )
    }
    const remote = {
      ...base,
      answers: base.answers.map((answer) =>
        answer.studySessionQuestionId === secondQuestionId
          ? { ...answer, selectedOptionId: secondOptionId }
          : answer
      ),
      revision: 2,
      savedAt: '2026-08-18T00:00:01.000Z'
    }

    const merged = mergeStudyDraftSnapshots(base, local, remote)

    expect(merged.conflicts).toEqual([])
    expect(merged.autoMerged.answers).toMatchObject([
      { selectedOptionId: firstOptionId },
      { selectedOptionId: secondOptionId }
    ])
    expect(merged.autoMerged.revision).toBe(2)
  })

  it('accepts the same answer selection on both sides but preserves remote metadata', () => {
    const base = createSnapshot()
    const selected = {
      ...base.answers[0],
      selectedOptionId: firstOptionId
    }
    const local = { ...base, answers: [selected, base.answers[1]] }
    const remote = {
      ...base,
      answers: [selected, base.answers[1]],
      revision: 2,
      savedAt: '2026-08-18T00:00:01.000Z'
    }

    const merged = mergeStudyDraftSnapshots(base, local, remote)

    expect(merged.conflicts).toEqual([])
    expect(merged.autoMerged.answers[0]?.selectedOptionId).toBe(firstOptionId)
    expect(merged.autoMerged.revision).toBe(2)
  })

  it('reports divergent selection, elapsed, and ordinal changes explicitly', () => {
    const base = createSnapshot()
    const local = {
      ...base,
      answers: [
        {
          ...base.answers[0],
          elapsedSec: 8,
          selectedOptionId: firstOptionId
        },
        base.answers[1]
      ],
      currentOrdinal: 2
    }
    const remote = {
      ...base,
      answers: [
        {
          ...base.answers[0],
          elapsedSec: 8,
          selectedOptionId: secondOptionId
        },
        base.answers[1]
      ],
      currentOrdinal: 1,
      revision: 2,
      savedAt: '2026-08-18T00:00:01.000Z'
    }

    const merged = mergeStudyDraftSnapshots(base, local, remote)

    expect(merged.conflicts.map(({ field }) => field)).toEqual([
      'selectedOptionId',
      'elapsedSec'
    ])
    expect(merged.autoMerged.answers[0]).toMatchObject({
      elapsedSec: 8,
      selectedOptionId: secondOptionId
    })
    expect(merged.localPreferred.answers[0]).toMatchObject({
      elapsedSec: 8,
      selectedOptionId: firstOptionId
    })
  })

  it('never guesses between different ordinal changes and round-trips post-flight diffs', () => {
    const initial = createSnapshot()
    const base = {
      ...initial,
      answers: [
        ...initial.answers,
        {
          elapsedSec: 0,
          selectedOptionId: null,
          studySessionQuestionId: thirdQuestionId
        }
      ],
      currentOrdinal: 1
    }
    const local = { ...base, currentOrdinal: 2 }
    const remote = {
      ...base,
      currentOrdinal: 3,
      revision: 2,
      savedAt: '2026-08-18T00:00:01.000Z'
    }

    const merged = mergeStudyDraftSnapshots(base, local, remote)
    const rebasedDiff = diffStudyDraftSnapshots(remote, merged.localPreferred)

    expect(merged.conflicts).toEqual([
      {
        base: 1,
        field: 'currentOrdinal',
        local: 2,
        remote: 3
      }
    ])
    expect(merged.autoMerged.currentOrdinal).toBe(3)
    expect(applyStudyDraftDiff(remote, rebasedDiff)).toEqual(
      merged.localPreferred
    )
  })
})
