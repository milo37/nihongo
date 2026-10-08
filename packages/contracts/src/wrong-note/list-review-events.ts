import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import {
  reviewEventSourceSchema,
  wrongNoteStatusSchema
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'

export const reviewEventCursorMaximumLength = 256 as const

const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

const rawReviewEventCursorTokenSchema = z
  .string()
  .min(1)
  .max(reviewEventCursorMaximumLength)
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor는 padding 없는 base64url이어야 합니다.')

export const reviewEventCursorV1Schema = z
  .object({
    v: z.literal(1),
    occurredAt: isoDateTimeSchema,
    id: opaqueIdSchema
  })
  .strict()

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const encodeAsciiBase64Url = (value: string): string => {
  const bytes = [...value].map((character) => {
    const byte = character.charCodeAt(0)
    if (byte > 0x7f) {
      throw new Error('ReviewEvent cursor canonical JSON은 ASCII여야 합니다.')
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
    throw new Error('ReviewEvent cursor base64url 길이가 올바르지 않습니다.')
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
      throw new Error('ReviewEvent cursor가 유효한 base64url이 아닙니다.')
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
    throw new Error('ReviewEvent cursor canonical JSON은 ASCII여야 합니다.')
  }

  return String.fromCharCode(...bytes)
}

export const encodeReviewEventCursor = (
  input: z.input<typeof reviewEventCursorV1Schema>
): string => {
  const cursor = reviewEventCursorV1Schema.parse(input)
  const canonicalJson = JSON.stringify({
    v: cursor.v,
    occurredAt: cursor.occurredAt,
    id: cursor.id
  })
  const encoded = encodeAsciiBase64Url(canonicalJson)

  if (encoded.length > reviewEventCursorMaximumLength) {
    throw new Error('ReviewEvent cursor가 최대 길이를 초과했습니다.')
  }

  return encoded
}

export const decodeReviewEventCursor = (
  token: string
): z.output<typeof reviewEventCursorV1Schema> => {
  const rawToken = rawReviewEventCursorTokenSchema.parse(token)
  const decoded = decodeAsciiBase64Url(rawToken)
  let candidate: unknown

  try {
    candidate = JSON.parse(decoded)
  } catch {
    throw new Error('ReviewEvent cursor JSON이 올바르지 않습니다.')
  }

  const cursor = reviewEventCursorV1Schema.parse(candidate)
  if (encodeReviewEventCursor(cursor) !== rawToken) {
    throw new Error('ReviewEvent cursor가 canonical encoding이 아닙니다.')
  }

  return cursor
}

export const reviewEventCursorTokenSchema =
  rawReviewEventCursorTokenSchema.superRefine((value, context) => {
    try {
      decodeReviewEventCursor(value)
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'cursor는 canonical ReviewEvent cursor여야 합니다.'
      })
    }
  })

const isValidReviewAlgorithmState = (
  status: z.output<typeof wrongNoteStatusSchema>,
  correctStreak: number,
  wrongCount: number
): boolean => {
  if (wrongCount < 1) {
    return false
  }

  switch (status) {
    case 'NEW':
      return wrongCount === 1 && correctStreak === 0
    case 'AGAIN':
      return wrongCount >= 2 && correctStreak === 0
    case 'REVIEWING':
      return correctStreak === 1
    case 'SOLVED':
      return correctStreak >= 2
  }
}

export const reviewEventHistoryItemSchema = z
  .object({
    id: opaqueIdSchema,
    source: reviewEventSourceSchema,
    questionVersionId: opaqueIdSchema,
    selectedOptionId: opaqueIdSchema.nullable(),
    isCorrect: z.boolean().nullable(),
    elapsedSec: safeNonNegativeIntegerSchema.nullable(),
    previousStatus: wrongNoteStatusSchema.nullable(),
    nextStatus: wrongNoteStatusSchema,
    previousCorrectStreak: safeNonNegativeIntegerSchema.nullable(),
    nextCorrectStreak: safeNonNegativeIntegerSchema,
    previousWrongCount: safeNonNegativeIntegerSchema.nullable(),
    wrongCountAfter: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    algorithmVersion: z.literal(1),
    occurredAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((event, context) => {
    const previousFields = [
      event.previousStatus,
      event.previousCorrectStreak,
      event.previousWrongCount
    ]
    const nullPreviousCount = previousFields.filter(
      (value) => value === null
    ).length

    if (
      nullPreviousCount !== 0 &&
      nullPreviousCount !== previousFields.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['previousStatus'],
        message:
          'previous state fields는 모두 null이거나 모두 non-null이어야 합니다.'
      })
    }

    if (event.source === 'VERSION_REBASE') {
      if (
        event.selectedOptionId !== null ||
        event.isCorrect !== null ||
        event.elapsedSec !== null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['source'],
          message: 'VERSION_REBASE event에는 answer outcome이 없어야 합니다.'
        })
      }
    } else if (event.isCorrect === null || event.elapsedSec === null) {
      context.addIssue({
        code: 'custom',
        path: ['isCorrect'],
        message: 'answer-backed event에는 isCorrect와 elapsedSec가 필요합니다.'
      })
    }

    if (event.isCorrect === true && event.selectedOptionId === null) {
      context.addIssue({
        code: 'custom',
        path: ['selectedOptionId'],
        message: '정답 event에는 selectedOptionId가 필요합니다.'
      })
    }

    const previousStatus = event.previousStatus
    if (previousStatus === null) {
      if (
        event.source === 'VERSION_REBASE' ||
        event.isCorrect !== false ||
        event.nextStatus !== 'NEW' ||
        event.nextCorrectStreak !== 0 ||
        event.wrongCountAfter !== 1
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nextStatus'],
          message:
            '첫 algorithm v1 event는 최초 오답 NEW transition이어야 합니다.'
        })
      }
      return
    }

    const previousCorrectStreak = event.previousCorrectStreak
    const previousWrongCount = event.previousWrongCount
    if (previousCorrectStreak === null || previousWrongCount === null) {
      return
    }

    if (
      !isValidReviewAlgorithmState(
        previousStatus,
        previousCorrectStreak,
        previousWrongCount
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['previousStatus'],
        message: 'previous algorithm v1 state가 올바르지 않습니다.'
      })
      return
    }

    if (event.source === 'VERSION_REBASE') {
      if (
        event.nextStatus !== previousStatus ||
        event.nextCorrectStreak !== previousCorrectStreak ||
        event.wrongCountAfter !== previousWrongCount
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nextStatus'],
          message:
            'VERSION_REBASE는 algorithm state/count를 바꾸지 않아야 합니다.'
        })
      }
      return
    }

    if (event.isCorrect === false) {
      if (
        event.nextStatus !== 'AGAIN' ||
        event.nextCorrectStreak !== 0 ||
        event.wrongCountAfter !== previousWrongCount + 1
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nextStatus'],
          message: 'algorithm v1 오답 event transition이 올바르지 않습니다.'
        })
      }
      return
    }

    if (event.isCorrect === true) {
      const expectedStreak = previousCorrectStreak + 1
      const expectedStatus = expectedStreak >= 2 ? 'SOLVED' : 'REVIEWING'
      if (
        event.nextStatus !== expectedStatus ||
        event.nextCorrectStreak !== expectedStreak ||
        event.wrongCountAfter !== previousWrongCount
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nextStatus'],
          message: 'algorithm v1 정답 event transition이 올바르지 않습니다.'
        })
      }
    }
  })

export const listReviewEventsOperationId = 'wrongNote.listReviewEvents' as const

export const listReviewEventsParamsSchema = z
  .object({ questionId: opaqueIdSchema })
  .strict()

export const listReviewEventsQuerySchema = z
  .object({
    cursor: reviewEventCursorTokenSchema.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict()

export const listReviewEventsResponseSchema = z
  .object({
    items: z.array(reviewEventHistoryItemSchema).max(100),
    nextCursor: reviewEventCursorTokenSchema.nullable()
  })
  .strict()
  .superRefine((connection, context) => {
    if (connection.items.length === 0 && connection.nextCursor !== null) {
      context.addIssue({
        code: 'custom',
        path: ['nextCursor'],
        message: '빈 history에는 nextCursor가 없어야 합니다.'
      })
      return
    }

    const eventIds = new Set<string>()
    connection.items.forEach((event, index) => {
      const previous = connection.items[index - 1]
      if (eventIds.has(event.id)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: 'ReviewEvent ID는 connection 안에서 서로 달라야 합니다.'
        })
      }
      eventIds.add(event.id)

      if (
        previous !== undefined &&
        (previous.occurredAt < event.occurredAt ||
          (previous.occurredAt === event.occurredAt && previous.id <= event.id))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index],
          message: 'ReviewEvent는 occurredAt DESC, id DESC 순서여야 합니다.'
        })
      }

      if (
        previous !== undefined &&
        (previous.previousStatus !== event.nextStatus ||
          previous.previousCorrectStreak !== event.nextCorrectStreak ||
          previous.previousWrongCount !== event.wrongCountAfter)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index],
          message: '인접 ReviewEvent의 previous/next state chain이 끊겼습니다.'
        })
      }

      if (
        event.previousStatus === null &&
        (index !== connection.items.length - 1 ||
          connection.nextCursor !== null)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'previousStatus'],
          message: '첫 ReviewEvent는 history의 마지막 item이어야 합니다.'
        })
      }
    })

    const lastItem = connection.items.at(-1)
    if (
      lastItem !== undefined &&
      lastItem.previousStatus !== null &&
      connection.nextCursor === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nextCursor'],
        message:
          '더 오래된 ReviewEvent가 존재하는 page에는 nextCursor가 필요합니다.'
      })
    }

    if (lastItem !== undefined && connection.nextCursor !== null) {
      const expectedCursor = encodeReviewEventCursor({
        v: 1,
        occurredAt: lastItem.occurredAt,
        id: lastItem.id
      })
      if (connection.nextCursor !== expectedCursor) {
        context.addIssue({
          code: 'custom',
          path: ['nextCursor'],
          message: 'nextCursor는 마지막 ReviewEvent의 exact cursor여야 합니다.'
        })
      }
    }
  })

export const listReviewEventsErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const listReviewEventsErrorSchema = createApiFailureSchema(
  listReviewEventsErrorCodeSchema
)

export type ReviewEventCursorV1 = z.output<typeof reviewEventCursorV1Schema>
export type ReviewEventHistoryItem = z.output<
  typeof reviewEventHistoryItemSchema
>
export type ListReviewEventsParams = z.input<
  typeof listReviewEventsParamsSchema
>
export type ListReviewEventsQuery = z.input<typeof listReviewEventsQuerySchema>
export type ParsedListReviewEventsQuery = z.output<
  typeof listReviewEventsQuerySchema
>
export type ListReviewEventsResponse = z.output<
  typeof listReviewEventsResponseSchema
>
export type ListReviewEventsError = z.output<typeof listReviewEventsErrorSchema>
