import { z } from 'zod'

import { isoDateTimeSchema } from './date.js'
import { opaqueIdSchema } from './id.js'
import { positiveSafeIntegerSchema } from './phase7.js'

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export const phase7CursorMaximumLength = 256 as const

const rawPhase7CursorSchema = z
  .string()
  .min(1)
  .max(phase7CursorMaximumLength)
  .regex(/^[A-Za-z0-9_-]+$/u, 'padding 없는 base64url이어야 합니다.')

export const versionCursorValueSchema = z
  .object({
    v: z.literal(1),
    versionNumber: positiveSafeIntegerSchema,
    id: opaqueIdSchema
  })
  .strict()

export const occurredAtCursorValueSchema = z
  .object({
    v: z.literal(1),
    occurredAt: isoDateTimeSchema,
    id: opaqueIdSchema
  })
  .strict()

const encodeAsciiBase64Url = (value: string): string => {
  const bytes = [...value].map((character) => {
    const byte = character.charCodeAt(0)
    if (byte > 0x7f) {
      throw new Error('Phase 7 cursor canonical JSON은 ASCII여야 합니다.')
    }
    return byte
  })
  let encoded = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    if (first === undefined) {
      break
    }

    encoded += BASE64URL_ALPHABET[first >> 2]
    encoded += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)]
    if (second !== undefined) {
      encoded +=
        BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]
    }
    if (third !== undefined) {
      encoded += BASE64URL_ALPHABET[third & 0x3f]
    }
  }

  return encoded
}

const decodeAsciiBase64Url = (value: string): string => {
  if (value.length % 4 === 1) {
    throw new Error('Phase 7 cursor base64url 길이가 올바르지 않습니다.')
  }

  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64URL_ALPHABET.indexOf(value[index] ?? '')
    const second = BASE64URL_ALPHABET.indexOf(value[index + 1] ?? '')
    const thirdCharacter = value[index + 2]
    const fourthCharacter = value[index + 3]
    const third =
      thirdCharacter === undefined
        ? undefined
        : BASE64URL_ALPHABET.indexOf(thirdCharacter)
    const fourth =
      fourthCharacter === undefined
        ? undefined
        : BASE64URL_ALPHABET.indexOf(fourthCharacter)

    if (
      first < 0 ||
      second < 0 ||
      (third !== undefined && third < 0) ||
      (fourth !== undefined && fourth < 0)
    ) {
      throw new Error('Phase 7 cursor가 유효한 base64url이 아닙니다.')
    }

    bytes.push((first << 2) | (second >> 4))
    if (third !== undefined) {
      bytes.push(((second & 0x0f) << 4) | (third >> 2))
    }
    if (fourth !== undefined && third !== undefined) {
      bytes.push(((third & 0x03) << 6) | fourth)
    }
  }

  if (bytes.some((byte) => byte > 0x7f)) {
    throw new Error('Phase 7 cursor canonical JSON은 ASCII여야 합니다.')
  }

  return String.fromCharCode(...bytes)
}

const encodeCursorJson = (value: object): string => {
  const token = encodeAsciiBase64Url(JSON.stringify(value))
  if (token.length > phase7CursorMaximumLength) {
    throw new Error('Phase 7 cursor가 최대 길이를 초과했습니다.')
  }
  return token
}

const parseCursorJson = (token: string): unknown => {
  const rawToken = rawPhase7CursorSchema.parse(token)
  try {
    return JSON.parse(decodeAsciiBase64Url(rawToken))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Phase 7 cursor JSON이 올바르지 않습니다.')
    }
    throw error
  }
}

export const encodeAdminQuestionVersionCursor = (input: {
  readonly versionNumber: number
  readonly id: string
}): string => {
  const cursor = versionCursorValueSchema.parse({ v: 1, ...input })
  return encodeCursorJson({
    v: cursor.v,
    versionNumber: cursor.versionNumber,
    id: cursor.id
  })
}

export const decodeAdminQuestionVersionCursor = (
  token: string
): z.output<typeof versionCursorValueSchema> => {
  const cursor = versionCursorValueSchema.parse(parseCursorJson(token))
  if (encodeAdminQuestionVersionCursor(cursor) !== token) {
    throw new Error('version cursor가 canonical encoding이 아닙니다.')
  }
  return cursor
}

export const encodePhase7OccurredAtCursor = (input: {
  readonly occurredAt: string
  readonly id: string
}): string => {
  const cursor = occurredAtCursorValueSchema.parse({ v: 1, ...input })
  return encodeCursorJson({
    v: cursor.v,
    occurredAt: cursor.occurredAt,
    id: cursor.id
  })
}

export const decodePhase7OccurredAtCursor = (
  token: string
): z.output<typeof occurredAtCursorValueSchema> => {
  const cursor = occurredAtCursorValueSchema.parse(parseCursorJson(token))
  if (encodePhase7OccurredAtCursor(cursor) !== token) {
    throw new Error('occurredAt cursor가 canonical encoding이 아닙니다.')
  }
  return cursor
}

export const adminQuestionVersionCursorSchema =
  rawPhase7CursorSchema.superRefine((value, context) => {
    try {
      decodeAdminQuestionVersionCursor(value)
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'canonical version cursor여야 합니다.'
      })
    }
  })

export const phase7OccurredAtCursorSchema = rawPhase7CursorSchema.superRefine(
  (value, context) => {
    try {
      decodePhase7OccurredAtCursor(value)
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'canonical occurredAt cursor여야 합니다.'
      })
    }
  }
)

export type VersionCursorValue = z.output<typeof versionCursorValueSchema>
export type OccurredAtCursorValue = z.output<typeof occurredAtCursorValueSchema>
