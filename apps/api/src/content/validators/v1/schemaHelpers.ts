import { z } from 'zod'
import {
  containsForbiddenControlCharacter,
  countUnicodeScalars,
  hasUnicodeEdgeWhitespace,
  isNfc,
  isWellFormedUnicode
} from '@nihongo/domain/content/validators/v1/unicode'

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
export const uuidSchema = z
  .string()
  .regex(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
  )
export const positiveSafeIntegerSchema = z.number().int().safe().min(1)
export const nonNegativeSafeIntegerSchema = z.number().int().safe().min(0)
export const utcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const timestamp = Date.parse(value)
    return (
      !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value
    )
  })

export const unicodeScalarStringSchema = (
  minimum: number,
  maximum: number,
  options: {
    readonly allowEdgeWhitespace?: boolean
    readonly allowLineFeed?: boolean
  } = {}
) =>
  z
    .string()
    .meta({ minLength: minimum, maxLength: maximum })
    .superRefine((value, context) => {
      if (!isWellFormedUnicode(value)) {
        context.addIssue({
          code: 'custom',
          message: 'well-formed Unicode가 아닙니다.'
        })
      }
      if (!isNfc(value)) {
        context.addIssue({ code: 'custom', message: 'NFC 문자열이 아닙니다.' })
      }
      const length = countUnicodeScalars(value)
      if (length < minimum || length > maximum) {
        context.addIssue({
          code: 'custom',
          message: `Unicode scalar 길이는 ${minimum}..${maximum}여야 합니다.`
        })
      }
      if (!options.allowEdgeWhitespace && hasUnicodeEdgeWhitespace(value)) {
        context.addIssue({
          code: 'custom',
          message: 'edge whitespace를 허용하지 않습니다.'
        })
      }
      if (containsForbiddenControlCharacter(value)) {
        context.addIssue({
          code: 'custom',
          message: '금지된 control character가 있습니다.'
        })
      }
      if (!options.allowLineFeed && value.includes('\n')) {
        context.addIssue({
          code: 'custom',
          message: 'line feed를 허용하지 않습니다.'
        })
      }
    })

export const contentKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/)
export const releaseKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/)
export const contributorRefSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/)

export const exactKeys = <Value extends Record<string, unknown>>(
  value: Value,
  expected: readonly string[]
): boolean => {
  const actual = Object.keys(value).toSorted()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected.toSorted()[index])
  )
}
