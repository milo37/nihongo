import { describe, expect, it } from 'vitest'
import { analyticsEventSchema } from './events.js'

const envelope = {
  schemaVersion: 1,
  occurredAt: '2026-10-01T00:00:00.000Z',
  environment: 'STAGING',
  releaseId: '1234567890abcdef1234567890abcdef12345678',
  correlationId: '00000000-0000-4000-8000-000000000001'
} as const

describe('privacy-safe analytics event contract', () => {
  it('accepts exactly the eleven coarse event shapes', () => {
    const events = [
      { event: 'sign_up', payload: {} },
      { event: 'login', payload: {} },
      {
        event: 'practice_configured',
        payload: {
          level: 'N3',
          subject: 'GRAMMAR',
          mode: 'RANDOM',
          questionCount: 10
        }
      },
      {
        event: 'study_started',
        payload: {
          level: 'N3',
          subject: 'GRAMMAR',
          mode: 'RANDOM',
          questionCount: 10
        }
      },
      { event: 'question_answered', payload: { ordinal: 3 } },
      {
        event: 'study_submitted',
        payload: { mode: 'RANDOM', questionCount: 10 }
      },
      {
        event: 'wrong_note_opened',
        payload: { surface: 'REVIEW_CENTER' }
      },
      {
        event: 'review_started',
        payload: { source: 'DAILY_REVIEW', questionCount: 5 }
      },
      {
        event: 'review_submitted',
        payload: { source: 'WRONG_NOTE', questionCount: 5 }
      },
      { event: 'bookmark_created', payload: { surface: 'RESULT' } },
      { event: 'question_reported', payload: { reason: 'ANSWER_ERROR' } }
    ]

    expect(
      events.map((event) =>
        analyticsEventSchema.parse({ ...envelope, ...event })
      )
    ).toHaveLength(11)
  })

  it.each([
    { ...envelope, event: 'unknown', payload: {} },
    { ...envelope, event: 'login', payload: { email: 'private@example.com' } },
    {
      ...envelope,
      event: 'question_answered',
      payload: { ordinal: 1, answer: 'private answer' }
    },
    {
      ...envelope,
      event: 'question_reported',
      payload: { reason: 'OTHER', reportText: 'private report' }
    },
    {
      ...envelope,
      event: 'study_submitted',
      payload: { mode: 'RANDOM', questionCount: 21 }
    },
    {
      ...envelope,
      event: 'login',
      payload: {},
      userId: '00000000-0000-4000-8000-000000000002'
    }
  ])('rejects unknown, identifying, authored, or excessive data', (event) => {
    expect(analyticsEventSchema.safeParse(event).success).toBe(false)
  })
})
