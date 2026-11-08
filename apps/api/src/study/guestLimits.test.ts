import {
  GUEST_DAILY_SESSION_LIMIT,
  GUEST_SESSION_QUESTION_LIMIT
} from '@nihongo/contracts/study/guest-limits'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import { guestDayKey, startOfGuestDay } from './guestDay.js'
import {
  GuestDailyLimitReachedError,
  type CreateStudyOwner,
  type StudySessionRepository
} from './studySessionRepository.js'
import { createStudySessionService } from './studySessionService.js'

describe('guest day (#737)', () => {
  it('starts at midnight Korea time', () => {
    // 2026-11-08 23:59:59 KST is still the 8th; 00:00 KST is the 9th.
    expect(startOfGuestDay(new Date('2026-11-08T14:59:59.999Z'))).toEqual(
      new Date('2026-11-07T15:00:00.000Z')
    )
    expect(startOfGuestDay(new Date('2026-11-08T15:00:00.000Z'))).toEqual(
      new Date('2026-11-08T15:00:00.000Z')
    )
    expect(guestDayKey(new Date('2026-11-08T14:59:59.999Z'))).toBe('2026-11-08')
    expect(guestDayKey(new Date('2026-11-08T15:00:00.000Z'))).toBe('2026-11-09')
  })
})

const guest: CreateStudyOwner = {
  kind: 'GUEST',
  guestPrincipalId: '11111111-1111-4111-8111-111111111111',
  tokenDigest: 'a'.repeat(64)
}
const member: CreateStudyOwner = {
  kind: 'USER',
  userId: '22222222-2222-4222-8222-222222222222'
}

const createService = (create = vi.fn()) =>
  createStudySessionService({
    create,
    findOwnedById: vi.fn()
  } as unknown as StudySessionRepository)

const body = (
  mode: 'RANDOM' | 'WEAKNESS' | 'WRONG_NOTE' | 'DAILY_REVIEW' | 'BOOKMARK',
  count: number
) => ({ level: 'N5', subject: 'VOCABULARY', mode, count }) as const

const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(ApplicationError)
  return error as ApplicationError
}

describe('guest study session limits (#737)', () => {
  it.each(['WEAKNESS', 'WRONG_NOTE', 'DAILY_REVIEW', 'BOOKMARK'] as const)(
    'asks a guest to sign in for %s mode',
    async (mode) => {
      const create = vi.fn()
      const error = await rejection(
        createService(create).create(body(mode, 1), guest)
      )
      expect(error.code).toBe('AUTHENTICATION_REQUIRED')
      expect(create).not.toHaveBeenCalled()
    }
  )

  it.each([1, GUEST_SESSION_QUESTION_LIMIT + 1])(
    'asks a guest for exactly the guest question count, not %i',
    async (count) => {
      const create = vi.fn()
      const error = await rejection(
        createService(create).create(body('RANDOM', count), guest)
      )
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.fieldErrors).toHaveProperty('count')
      expect(create).not.toHaveBeenCalled()
    }
  )

  it('does not limit members', async () => {
    const create = vi.fn().mockRejectedValue(new Error('reached repository'))
    await expect(
      createService(create).create(
        body('RANDOM', GUEST_SESSION_QUESTION_LIMIT + 1),
        member
      )
    ).rejects.toThrow('reached repository')
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedCount: GUEST_SESSION_QUESTION_LIMIT + 1
      })
    )
  })

  it('reports the daily guest limit as GUEST_LIMIT_REACHED', async () => {
    const resetsAt = new Date('2026-11-08T15:00:00.000Z')
    const create = vi
      .fn()
      .mockRejectedValue(new GuestDailyLimitReachedError(resetsAt))
    const error = await rejection(
      createService(create).create(
        body('RANDOM', GUEST_SESSION_QUESTION_LIMIT),
        guest
      )
    )
    expect(error.code).toBe('GUEST_LIMIT_REACHED')
    expect(error.message).toContain(String(GUEST_DAILY_SESSION_LIMIT))
    expect(error.details).toEqual({ resetsAt: '2026-11-08T15:00:00.000Z' })
  })
})
