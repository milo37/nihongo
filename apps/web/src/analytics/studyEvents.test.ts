import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsClient } from '@/analytics/client'
import { trackStudySubmission } from '@/analytics/studyEvents'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'

const createSession = (
  mode: StudySessionView['session']['mode']
): StudySessionView => ({
  session: {
    id: 'session-1',
    level: 'N3',
    subject: 'GRAMMAR',
    mode,
    status: 'IN_PROGRESS',
    startedAt: '2026-10-01T00:00:00.000Z',
    expiresAt: null,
    submittedAt: null,
    durationSec: null,
    practiceContractVersion: 2
  },
  questions: [],
  requestedCount: 5,
  actualCount: 5,
  usedFallback: false,
  fallbackReason: null
})

describe('study analytics success boundaries', () => {
  it('records a normal submission without a review event', () => {
    const track = vi.fn(() => true)
    trackStudySubmission({
      analytics: { track } satisfies AnalyticsClient,
      questionCount: 5,
      session: createSession('RANDOM')
    })

    expect(track).toHaveBeenCalledExactlyOnceWith({
      event: 'study_submitted',
      payload: { mode: 'RANDOM', questionCount: 5 }
    })
  })

  it.each(['DAILY_REVIEW', 'WRONG_NOTE'] as const)(
    'records submission and review completion for %s',
    (mode) => {
      const track = vi.fn(() => true)
      trackStudySubmission({
        analytics: { track } satisfies AnalyticsClient,
        questionCount: 3,
        session: createSession(mode)
      })

      expect(track.mock.calls).toEqual([
        [
          {
            event: 'study_submitted',
            payload: { mode, questionCount: 3 }
          }
        ],
        [
          {
            event: 'review_submitted',
            payload: { source: mode, questionCount: 3 }
          }
        ]
      ])
    }
  )

  it('does not invent a submission event without an authoritative session', () => {
    const track = vi.fn(() => true)
    trackStudySubmission({
      analytics: { track } satisfies AnalyticsClient,
      questionCount: 5,
      session: undefined
    })

    expect(track).not.toHaveBeenCalled()
  })
})
