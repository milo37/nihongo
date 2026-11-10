import { describe, expect, it } from 'vitest'
import { isApiError } from '@nihongo/browser/api/config'
import { createResultRetrySession } from '@api/study/createResultRetrySession'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { mockGuestAllowance } from '@mocks/handlers/guestAllowanceHandlers'

describe('mock guest result retry (JLP-823)', () => {
  it('replays a retry already made before checking the day limit', async () => {
    const created = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 3
    })
    const sessionId = created.data.session.id
    const draft = (await getStudyDraftAnswers(sessionId)).data
    await submitStudySessionV2(
      sessionId,
      {
        answers: draft.answers,
        durationSec: 0,
        expectedDraftRevision: draft.revision
      },
      crypto.randomUUID()
    )
    mockGuestAllowance.enforce()
    mockGuestAllowance.setRemaining(1)
    const key = crypto.randomUUID()

    const first = await createResultRetrySession(sessionId, key)
    expect(mockGuestAllowance.remaining()).toBe(0)
    // The same key again is the same retry, not a new try.
    const replay = await createResultRetrySession(sessionId, key)
    expect(replay.data.session.id).toBe(first.data.session.id)
    expect(mockGuestAllowance.remaining()).toBe(0)

    const refused = await createResultRetrySession(
      sessionId,
      crypto.randomUUID()
    ).catch((error: unknown) => error)
    expect(isApiError(refused) && refused.code).toBe('GUEST_LIMIT_REACHED')
  })
})
