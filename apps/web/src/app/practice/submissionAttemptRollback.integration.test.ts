import { QueryClient } from '@tanstack/react-query'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import {
  getOrCreateCanonicalSubmissionAttempt,
  getSubmissionAttemptStorageKey
} from '@app/practice/submissionAttempt'

describe('submission attempt rollback compatibility', () => {
  it('clears a stored real attempt when a mock-mode session lookup returns 404', async () => {
    const sessionId = crypto.randomUUID()
    const questionId = crypto.randomUUID()
    const session: StudySessionView = {
      session: {
        id: sessionId,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        status: 'IN_PROGRESS',
        startedAt: '2026-08-16T00:00:00.000Z',
        expiresAt: '2026-08-17T00:00:00.000Z',
        submittedAt: null,
        durationSec: null
      },
      questions: [
        {
          id: questionId,
          sessionQuestionId: crypto.randomUUID(),
          questionVersionId: crypto.randomUUID(),
          ordinal: 1,
          level: 'N5',
          subject: 'VOCABULARY',
          questionType: 'KANJI_READING',
          passage: null,
          questionText: '롤백 후에는 없는 세션',
          options: [1, 2, 3, 4].map((value) => ({
            id: crypto.randomUUID(),
            label: String(value) as '1' | '2' | '3' | '4',
            text: `${value}번 보기`
          })),
          difficulty: 'NORMAL',
          tags: ['롤백']
        }
      ],
      requestedCount: 1,
      actualCount: 1,
      usedFallback: false,
      fallbackReason: null
    }
    getOrCreateCanonicalSubmissionAttempt(
      sessionId,
      { answers: [], durationSec: 2 },
      session
    )
    expect(
      window.sessionStorage.getItem(getSubmissionAttemptStorageKey(sessionId))
    ).not.toBeNull()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })

    await expect(
      client.fetchQuery(studySessionQueries.session(sessionId))
    ).rejects.toThrow()
    expect(
      window.sessionStorage.getItem(getSubmissionAttemptStorageKey(sessionId))
    ).toBeNull()
  })
})
