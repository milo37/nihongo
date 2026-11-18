import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'

export const updateNicknameOperationId = 'auth.updateNickname' as const

/**
 * #1096: the member's nickname, stored in "User"."name" (`/me` returns it as
 * `name`). After trimming the ends it is 2 to 12 characters, each code point
 * one character (`Array.from`), with no line break or other control
 * character. Spaces inside are kept; the same nickname may belong to many.
 */
export const NICKNAME_MIN_CHARACTERS = 2
export const NICKNAME_MAX_CHARACTERS = 12

const CONTROL_CHARACTER = /[\p{Cc}\u2028\u2029]/u

export const nicknameLength = (value: string): number =>
  Array.from(value).length

export const nicknameSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      nicknameLength(value) >= NICKNAME_MIN_CHARACTERS &&
      nicknameLength(value) <= NICKNAME_MAX_CHARACTERS &&
      !CONTROL_CHARACTER.test(value),
    { message: '닉네임을 2자 이상 입력해 주세요' }
  )

/**
 * The prefilled value: the name trimmed and cut to its first 12 characters
 * (then trimmed again), or '' when fewer than 2 remain or a control character
 * is left. The field shows '' as empty with the 2~12 hint.
 */
export const defaultNickname = (name: string): string => {
  const cut = Array.from(name.trim())
    .slice(0, NICKNAME_MAX_CHARACTERS)
    .join('')
    .trim()
  return nicknameSchema.safeParse(cut).success ? cut : ''
}

export const updateNicknameBodySchema = z
  .object({ nickname: nicknameSchema })
  .strict()

export const updateNicknameResponseSchema = z
  .object({ nickname: nicknameSchema })
  .strict()

export const updateNicknameErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_JSON',
  // fieldErrors.nickname: the nickname breaks the 2~12 rule.
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const updateNicknameErrorSchema = createApiFailureSchema(
  updateNicknameErrorCodeSchema
)

export type UpdateNicknameBody = z.input<typeof updateNicknameBodySchema>
export type UpdateNicknameResponse = z.output<
  typeof updateNicknameResponseSchema
>
export type UpdateNicknameError = z.output<typeof updateNicknameErrorSchema>
