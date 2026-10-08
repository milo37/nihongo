import { describe, expect, it } from 'vitest'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import {
  createFrozenStudyDraftAttempt,
  createStudyDraftWorkingCopy,
  parseStudyDraftWorkingCopy
} from '@app/practice/draft/studyDraftWorkingCopy'
import {
  diffStudyDraftSnapshots,
  mergeStudyDraftSnapshots
} from '@app/practice/draft/studyDraftMerge'

const sessionId = '00000000-0000-4000-8000-000000000011'
const firstQuestionId = '00000000-0000-4000-8000-000000000012'
const secondQuestionId = '00000000-0000-4000-8000-000000000013'
const optionId = '00000000-0000-4000-8000-000000000014'
const principalScope = 'USER:00000000-0000-4000-8000-000000000015'

const createSnapshot = (): StudyDraftSnapshot => ({
  answers: [
    {
      elapsedSec: 1,
      selectedOptionId: null,
      studySessionQuestionId: firstQuestionId
    },
    {
      elapsedSec: 2,
      selectedOptionId: null,
      studySessionQuestionId: secondQuestionId
    }
  ],
  currentOrdinal: 1,
  revision: 1,
  savedAt: '2026-08-18T00:00:00.000Z',
  studySessionId: sessionId
})

describe('study draft working-copy integrity', () => {
  it('round-trips a scoped record and exact frozen request', () => {
    const confirmedBase = createSnapshot()
    const record = createStudyDraftWorkingCopy({
      confirmedBase,
      principalScope,
      sessionId
    })
    record.frozenAttempt = createFrozenStudyDraftAttempt({
      body: {
        answers: [
          {
            elapsedSec: 3,
            selectedOptionId: optionId,
            studySessionQuestionId: firstQuestionId
          },
          confirmedBase.answers[1]
        ],
        currentOrdinal: 2,
        expectedRevision: 1
      },
      idempotencyKey: '00000000-0000-4000-8000-000000000016',
      sessionId
    })

    expect(
      parseStudyDraftWorkingCopy(record, { principalScope, sessionId })
    ).toEqual(record)
  })

  it('rejects owner, session, base digest, and frozen canonical mismatches', () => {
    const record = createStudyDraftWorkingCopy({
      confirmedBase: createSnapshot(),
      principalScope,
      sessionId
    })

    expect(
      parseStudyDraftWorkingCopy(record, {
        principalScope: 'ADMIN:00000000-0000-4000-8000-000000000017',
        sessionId
      })
    ).toBeNull()
    expect(
      parseStudyDraftWorkingCopy(record, {
        principalScope,
        sessionId: '00000000-0000-4000-8000-000000000018'
      })
    ).toBeNull()
    expect(
      parseStudyDraftWorkingCopy(
        { ...record, confirmedBaseDigest: 'tampered' },
        { principalScope, sessionId }
      )
    ).toBeNull()

    const frozen = createFrozenStudyDraftAttempt({
      body: {
        answers: record.confirmedBase.answers,
        currentOrdinal: 1,
        expectedRevision: 1
      },
      idempotencyKey: '00000000-0000-4000-8000-000000000019',
      sessionId
    })
    expect(
      parseStudyDraftWorkingCopy(
        {
          ...record,
          frozenAttempt: {
            ...frozen,
            canonicalHashInput: `${frozen.canonicalHashInput}x`
          }
        },
        { principalScope, sessionId }
      )
    ).toBeNull()
  })

  it('rejects impossible diff ownership, ordinal, and flight-state combinations', () => {
    const record = createStudyDraftWorkingCopy({
      confirmedBase: createSnapshot(),
      principalScope,
      sessionId
    })
    const foreignQuestionId = '00000000-0000-4000-8000-000000000020'

    expect(
      parseStudyDraftWorkingCopy(
        {
          ...record,
          localDiff: {
            answers: { [foreignQuestionId]: { elapsedSec: 3 } }
          }
        },
        { principalScope, sessionId }
      )
    ).toBeNull()
    expect(
      parseStudyDraftWorkingCopy(
        {
          ...record,
          localDiff: { answers: {}, currentOrdinal: 3 }
        },
        { principalScope, sessionId }
      )
    ).toBeNull()
    expect(
      parseStudyDraftWorkingCopy(
        {
          ...record,
          postFlightLocalDiff: {
            answers: { [firstQuestionId]: { elapsedSec: 4 } }
          }
        },
        { principalScope, sessionId }
      )
    ).toBeNull()
  })

  it('persists an unresolved three-way conflict and rejects tampered conflict facts', () => {
    const base = createSnapshot()
    const local = {
      ...base,
      answers: base.answers.map((answer, index) =>
        index === 0 ? { ...answer, selectedOptionId: optionId } : answer
      )
    }
    const remoteOptionId = '00000000-0000-4000-8000-000000000021'
    const remote = {
      ...base,
      revision: 2,
      savedAt: '2026-08-18T00:01:00.000Z',
      answers: base.answers.map((answer, index) =>
        index === 0
          ? { ...answer, selectedOptionId: remoteOptionId }
          : { ...answer, elapsedSec: answer.elapsedSec + 3 }
      )
    }
    const merged = mergeStudyDraftSnapshots(base, local, remote)
    const record = createStudyDraftWorkingCopy({
      confirmedBase: remote,
      principalScope,
      sessionId
    })
    record.localDiff = diffStudyDraftSnapshots(remote, merged.localPreferred)
    record.pendingConflict = {
      base,
      conflicts: merged.conflicts,
      local,
      localPreferred: merged.localPreferred,
      remote
    }

    expect(
      parseStudyDraftWorkingCopy(record, { principalScope, sessionId })
    ).toEqual(record)
    expect(
      parseStudyDraftWorkingCopy(
        {
          ...record,
          pendingConflict: {
            ...record.pendingConflict,
            localPreferred: {
              ...record.pendingConflict.localPreferred,
              currentOrdinal: 2
            }
          }
        },
        { principalScope, sessionId }
      )
    ).toBeNull()
    expect(
      parseStudyDraftWorkingCopy(
        {
          ...record,
          pendingConflict: {
            ...record.pendingConflict,
            base: {
              ...record.pendingConflict.base,
              answers: record.pendingConflict.base.answers.map(
                (answer, index) =>
                  index === 0
                    ? {
                        ...answer,
                        studySessionQuestionId:
                          '00000000-0000-4000-8000-000000000022'
                      }
                    : answer
              )
            }
          }
        },
        { principalScope, sessionId }
      )
    ).toBeNull()
  })
})
