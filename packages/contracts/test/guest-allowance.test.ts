import { describe, expect, it } from 'vitest'
import {
  getGuestAllowanceResponseSchema,
  guestAllowanceExamples
} from '../src/study/get-guest-allowance.js'

describe('guest allowance contract (#737)', () => {
  it.each(Object.entries(guestAllowanceExamples))(
    'accepts the %s example',
    (_, example) => {
      expect(getGuestAllowanceResponseSchema.parse(example)).toEqual(example)
    }
  )

  it.each([-1, 0.5, 4])('rejects remaining %s', (remaining) => {
    expect(
      getGuestAllowanceResponseSchema.safeParse({
        ...guestAllowanceExamples.one,
        remaining
      }).success
    ).toBe(false)
  })

  it('rejects extra fields and a member with guest numbers', () => {
    expect(
      getGuestAllowanceResponseSchema.safeParse({
        ...guestAllowanceExamples.one,
        secondsLeft: 60
      }).success
    ).toBe(false)
    expect(
      getGuestAllowanceResponseSchema.safeParse({ kind: 'USER', remaining: 2 })
        .success
    ).toBe(false)
  })
})
