import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  crossedMemberDailyAlert,
  MEMBER_DAILY_ALERT_QUESTIONS,
  MEMBER_DAILY_ALERT_SESSIONS,
  MemberSessionCapReachedError
} from './memberSessionCap.js'
import type {
  CreateStudyOwner,
  StudySessionRepository
} from './studySessionRepository.js'
import { createStudySessionService } from './studySessionService.js'

const member: CreateStudyOwner = {
  kind: 'USER',
  userId: '22222222-2222-4222-8222-222222222222'
}
const body = {
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  count: 10
} as const
const now = new Date('2026-11-14T03:00:00.000Z')

const serviceWith = (create: ReturnType<typeof vi.fn>, warn = vi.fn()) => ({
  warn,
  service: createStudySessionService(
    { create, findOwnedById: vi.fn() } as unknown as StudySessionRepository,
    () => now,
    { warn }
  )
})

const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(ApplicationError)
  return error as ApplicationError
}

describe('member random session cap (#1006)', () => {
  it.each([
    ['HOUR', 'STUDY_HOURLY_LIMIT_REACHED', '2026-11-14T03:20:00.000Z', 1_200],
    ['DAY', 'STUDY_DAILY_LIMIT_REACHED', '2026-11-14T15:00:00.000Z', 43_200]
  ] as const)(
    'reports the %s limit as %s with resetsAt and Retry-After',
    async (window, code, resetsAt, retryAfterSeconds) => {
      const { service } = serviceWith(
        vi
          .fn()
          .mockRejectedValue(
            new MemberSessionCapReachedError(window, new Date(resetsAt))
          )
      )
      const error = await rejection(service.create(body, member))
      expect(error).toMatchObject({
        code,
        details: { resetsAt },
        retryAfterSeconds,
        retryable: false
      })
      expect(error.message).not.toMatch(/\d/u)
      expect(
        apiFailureSchema.safeParse({
          code,
          message: error.message,
          details: error.details,
          requestId: '019d0000-0000-7000-8000-000000000001',
          retryable: false
        }).success
      ).toBe(true)
    }
  )

  it('logs a busy day once, without stopping the member', async () => {
    const session = { actualCount: 10 }
    const created = (sessions: number, questions: number) =>
      vi.fn().mockResolvedValue({
        session,
        issuedGuestCredential: null,
        memberDailyVolume: { sessions, questions }
      })
    const crossing = serviceWith(created(MEMBER_DAILY_ALERT_SESSIONS - 1, 100))
    await crossing.service.create(body, member).catch(() => undefined)
    expect(crossing.warn).toHaveBeenCalledWith(
      'study.member_daily_volume_high',
      {
        crossed: 'SESSIONS',
        sessionsToday: MEMBER_DAILY_ALERT_SESSIONS,
        questionsToday: 110
      }
    )

    const after = serviceWith(created(MEMBER_DAILY_ALERT_SESSIONS, 100))
    await after.service.create(body, member).catch(() => undefined)
    expect(after.warn).not.toHaveBeenCalled()
  })

  it('crosses the alert lines only once a day', () => {
    expect(
      crossedMemberDailyAlert(
        { sessions: MEMBER_DAILY_ALERT_SESSIONS - 1, questions: 0 },
        5
      )
    ).toBe('SESSIONS')
    expect(
      crossedMemberDailyAlert(
        { sessions: 3, questions: MEMBER_DAILY_ALERT_QUESTIONS - 5 },
        10
      )
    ).toBe('QUESTIONS')
    expect(
      crossedMemberDailyAlert(
        { sessions: 3, questions: MEMBER_DAILY_ALERT_QUESTIONS },
        10
      )
    ).toBeNull()
    expect(crossedMemberDailyAlert({ sessions: 3, questions: 10 }, 10)).toBe(
      null
    )
  })

  it('keeps details for limit codes only', () => {
    expect(
      apiFailureSchema.safeParse({
        code: 'RATE_LIMITED',
        message: '잠시 뒤 다시 시도해 주세요.',
        details: { resetsAt: '2026-11-14T15:00:00.000Z' },
        requestId: '019d0000-0000-7000-8000-000000000001',
        retryable: true
      }).success
    ).toBe(false)
    expect(
      apiFailureSchema.safeParse({
        code: 'STUDY_DAILY_LIMIT_REACHED',
        message: '오늘 풀 수 있는 새 세트를 다 풀었어요.',
        requestId: '019d0000-0000-7000-8000-000000000001',
        retryable: false
      }).success
    ).toBe(false)
  })
})
