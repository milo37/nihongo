import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { opaqueIdSchema } from '../common/id.js'

export const userMemoMaximumCodePoints = 2_000 as const

const containsPostgresTextNullByte = (value: string): boolean =>
  value.includes('\u0000')

const isWellFormedUnicodeScalarSequence = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false
      }
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return false
      }
      index += 1
      continue
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }

  return true
}

export const normalizeUserMemoText = (value: string): string | null => {
  const normalized = value.trim()

  return normalized.length === 0 ? null : normalized
}

export const userMemoInputSchema = z
  .string()
  .superRefine((value, context) => {
    if (containsPostgresTextNullByte(value)) {
      context.addIssue({
        code: 'custom',
        message:
          'memo에는 PostgreSQL TEXT가 저장할 수 없는 NUL 문자를 사용할 수 없습니다.'
      })
    }

    if (!isWellFormedUnicodeScalarSequence(value)) {
      context.addIssue({
        code: 'custom',
        message: 'memo는 well-formed Unicode scalar sequence여야 합니다.'
      })
    }

    const normalized = normalizeUserMemoText(value)

    if (
      normalized !== null &&
      [...normalized].length > userMemoMaximumCodePoints
    ) {
      context.addIssue({
        code: 'custom',
        message: `memo는 trim 후 Unicode code point 기준 ${userMemoMaximumCodePoints}자 이하여야 합니다.`
      })
    }
  })
  .transform(normalizeUserMemoText)

export const userMemoTextSchema = z.string().superRefine((value, context) => {
  if (containsPostgresTextNullByte(value)) {
    context.addIssue({
      code: 'custom',
      message: '저장된 memo text에는 NUL 문자가 없어야 합니다.'
    })
  }

  if (!isWellFormedUnicodeScalarSequence(value)) {
    context.addIssue({
      code: 'custom',
      message:
        '저장된 memo text는 well-formed Unicode scalar sequence여야 합니다.'
    })
  }

  if (normalizeUserMemoText(value) !== value) {
    context.addIssue({
      code: 'custom',
      message: '저장된 memo text는 ECMAScript trim 기준 정규형이어야 합니다.'
    })
  }

  const codePointCount = [...value].length
  if (codePointCount < 1 || codePointCount > userMemoMaximumCodePoints) {
    context.addIssue({
      code: 'custom',
      message: `memo text는 Unicode code point 기준 1..${userMemoMaximumCodePoints}자여야 합니다.`
    })
  }
})

export const userMemoSchema = z
  .object({
    questionId: opaqueIdSchema,
    text: userMemoTextSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((memo, context) => {
    if (memo.updatedAt < memo.createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'memo updatedAt은 createdAt보다 빠를 수 없습니다.'
      })
    }
  })

export const createUserMemoForQuestionSchema = (questionId: string) => {
  const expectedQuestionId = opaqueIdSchema.parse(questionId)

  return userMemoSchema.nullable().superRefine((memo, context) => {
    if (memo !== null && memo.questionId !== expectedQuestionId) {
      context.addIssue({
        code: 'custom',
        path: ['questionId'],
        message: 'memo questionId는 요청 경로 questionId와 같아야 합니다.'
      })
    }
  })
}

export type UserMemo = z.output<typeof userMemoSchema>
