import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import { createStudyDraftWorkingCopy } from '@app/practice/draft/studyDraftWorkingCopy'
import {
  clearAllStudyDraftWorkingCopies,
  clearGuestStudyDraftWorkingCopies,
  clearStudyDraftWorkingCopyMemoryCache,
  readStudyDraftWorkingCopy,
  StudyDraftWorkingCopyPersistenceError,
  writeStudyDraftWorkingCopy
} from '@app/practice/draft/studyDraftWorkingCopyStorage'
import { cachedSessionStorage } from '@libs/storage'

const createSnapshot = (sessionId: string): StudyDraftSnapshot => ({
  answers: [
    {
      elapsedSec: 0,
      selectedOptionId: null,
      studySessionQuestionId: crypto.randomUUID()
    }
  ],
  currentOrdinal: 1,
  revision: 0,
  savedAt: null,
  studySessionId: sessionId
})

const createRecord = (principalScope: string, sessionId: string) =>
  createStudyDraftWorkingCopy({
    confirmedBase: createSnapshot(sessionId),
    principalScope,
    sessionId
  })

describe('study draft working-copy storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearAllStudyDraftWorkingCopies()
  })

  it('persists atomically and restores after the memory cache is cleared', () => {
    const sessionId = crypto.randomUUID()
    const record = createRecord(`USER:${crypto.randomUUID()}`, sessionId)

    writeStudyDraftWorkingCopy(record)
    clearStudyDraftWorkingCopyMemoryCache()

    expect(readStudyDraftWorkingCopy(record.principalScope, sessionId)).toEqual(
      record
    )
  })

  it('fails closed without publishing a memory record when durable storage fails', () => {
    const sessionId = crypto.randomUUID()
    const record = createRecord(`USER:${crypto.randomUUID()}`, sessionId)
    vi.spyOn(cachedSessionStorage, 'setItem').mockReturnValueOnce(false)

    expect(() => writeStudyDraftWorkingCopy(record)).toThrow(
      StudyDraftWorkingCopyPersistenceError
    )
    expect(
      readStudyDraftWorkingCopy(record.principalScope, sessionId)
    ).toBeNull()
  })

  it('clears guest records without exposing or deleting signed-in records', () => {
    const guestSessionId = crypto.randomUUID()
    const userSessionId = crypto.randomUUID()
    const userScope = `USER:${crypto.randomUUID()}`
    writeStudyDraftWorkingCopy(createRecord('GUEST', guestSessionId))
    writeStudyDraftWorkingCopy(createRecord(userScope, userSessionId))

    clearGuestStudyDraftWorkingCopies()
    clearStudyDraftWorkingCopyMemoryCache()

    expect(readStudyDraftWorkingCopy('GUEST', guestSessionId)).toBeNull()
    expect(readStudyDraftWorkingCopy(userScope, userSessionId)).not.toBeNull()
  })
})
