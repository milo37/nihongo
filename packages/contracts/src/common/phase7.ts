import { z } from 'zod'

import { persistedUserRoleSchema } from './enum.js'
import { opaqueIdSchema } from './id.js'

const hasForbiddenPhase7Control = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    )
  })
const UNPAIRED_SURROGATE_PATTERN = /[\ud800-\udfff]/u
const UNICODE_WHITESPACE_RUN_PATTERN = /\p{White_Space}+/gu
const LEADING_UNICODE_WHITESPACE_PATTERN = /^\p{White_Space}+/u
const TRAILING_UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+$/u

export const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)

export const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export const rowVersionSchema = positiveSafeIntegerSchema
export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u)

export const questionLifecycleStatusSchema = z.enum(['ACTIVE', 'ARCHIVED'])
export const questionVersionStatusSchema = z.enum([
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'RETIRED'
])
export const retirementKindSchema = z.enum([
  'PUBLISHED_RETIREMENT',
  'AUTHOR_ERASURE_ABANDONED',
  'QUESTION_ARCHIVE_ABANDONED'
])

export const accountActorLabelSchema = z.enum([
  'ACTIVE_USER',
  'DELETED_USER',
  'ACTIVE_ADMIN',
  'DELETED_ADMIN'
])

export const accountActorSnapshotSchema = z
  .object({
    kind: z.literal('ACCOUNT'),
    actorId: opaqueIdSchema,
    role: persistedUserRoleSchema,
    label: accountActorLabelSchema
  })
  .strict()
  .superRefine((actor, context) => {
    const matchesRole =
      (actor.role === 'USER' && actor.label.endsWith('_USER')) ||
      (actor.role === 'ADMIN' && actor.label.endsWith('_ADMIN'))

    if (!matchesRole) {
      context.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'actor role과 label 역할이 일치해야 합니다.'
      })
    }
  })

export const adminActorSnapshotSchema = accountActorSnapshotSchema.refine(
  (actor) => actor.role === 'ADMIN',
  { path: ['role'], message: 'ADMIN actor여야 합니다.' }
)

export const systemActorSnapshotSchema = z
  .object({
    kind: z.literal('SYSTEM'),
    actorId: z.null(),
    role: z.literal('SYSTEM'),
    label: z.literal('ACCOUNT_ERASURE')
  })
  .strict()

export const safeActorSnapshotSchema = z.union([
  accountActorSnapshotSchema,
  systemActorSnapshotSchema
])

export const countUnicodeScalars = (value: string): number => [...value].length

export const compareUnicodeScalars = (left: string, right: string): number => {
  const leftScalars = [...left]
  const rightScalars = [...right]
  const length = Math.min(leftScalars.length, rightScalars.length)

  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftScalars[index]?.codePointAt(0) ?? 0
    const rightPoint = rightScalars[index]?.codePointAt(0) ?? 0
    if (leftPoint !== rightPoint) {
      return leftPoint < rightPoint ? -1 : 1
    }
  }

  return leftScalars.length - rightScalars.length
}

export interface Phase7TextOptions {
  readonly minScalars?: number
  readonly maxScalars: number
  readonly multiline?: boolean
}

const normalizeLineEndings = (value: string): string =>
  value.replace(/\r\n?/gu, '\n')

export const normalizePhase7Text = (value: string): string =>
  normalizeLineEndings(value)
    .normalize('NFC')
    .replace(LEADING_UNICODE_WHITESPACE_PATTERN, '')
    .replace(TRAILING_UNICODE_WHITESPACE_PATTERN, '')

export const createPhase7TextSchema = ({
  minScalars = 1,
  maxScalars,
  multiline = false
}: Phase7TextOptions) =>
  z
    .string()
    .refine((value) => !UNPAIRED_SURROGATE_PATTERN.test(value), {
      message: '유효한 Unicode scalar value만 허용합니다.'
    })
    .transform(normalizePhase7Text)
    .refine(
      (value) =>
        countUnicodeScalars(value) >= minScalars &&
        countUnicodeScalars(value) <= maxScalars,
      {
        message: `${minScalars}..${maxScalars} Unicode scalar 길이여야 합니다.`
      }
    )
    .refine((value) => !hasForbiddenPhase7Control(value), {
      message: '제어 문자는 허용하지 않습니다.'
    })
    .refine((value) => multiline || !value.includes('\n'), {
      message: '한 줄 문자열이어야 합니다.'
    })

export const isWellFormedPhase7Text = (value: string): boolean =>
  !UNPAIRED_SURROGATE_PATTERN.test(value) && !hasForbiddenPhase7Control(value)

export const normalizePhase7TagKey = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(LEADING_UNICODE_WHITESPACE_PATTERN, '')
    .replace(TRAILING_UNICODE_WHITESPACE_PATTERN, '')
    .replace(UNICODE_WHITESPACE_RUN_PATTERN, ' ')
    .replace(/[A-Z]/gu, (character) => character.toLowerCase())

export const normalizePhase7DuplicateText = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(LEADING_UNICODE_WHITESPACE_PATTERN, '')
    .replace(TRAILING_UNICODE_WHITESPACE_PATTERN, '')
    .replace(UNICODE_WHITESPACE_RUN_PATTERN, ' ')
    .replace(/[A-Z]/gu, (character) => character.toLowerCase())

export interface Phase7QuestionDuplicateIdentityMaterial {
  readonly correctOptionText: string
  readonly optionTexts: readonly string[]
  readonly passage: string | null
  readonly questionText: string
  readonly questionType: string
  readonly subject: string
}

export const createPhase7QuestionDuplicateIdentity = (
  material: Phase7QuestionDuplicateIdentityMaterial
): string =>
  canonicalizeJson({
    correctOptionText: normalizePhase7DuplicateText(material.correctOptionText),
    optionTexts: material.optionTexts
      .map(normalizePhase7DuplicateText)
      .toSorted(compareUnicodeScalars),
    passage:
      material.passage === null
        ? null
        : normalizePhase7DuplicateText(material.passage),
    questionText: normalizePhase7DuplicateText(material.questionText),
    questionType: material.questionType,
    subject: material.subject
  })

export const phase7TagKeySchema = createPhase7TextSchema({ maxScalars: 500 })
  .transform(normalizePhase7TagKey)
  .refine((value) => countUnicodeScalars(value) <= 100, {
    message: '정규화된 태그 key는 100 Unicode scalar 이하여야 합니다.'
  })

export const phase7QuestionSearchSchema = createPhase7TextSchema({
  maxScalars: 100
})

export const assertPhase7DateRange = (
  from: string | undefined,
  to: string | undefined
): void => {
  if (from === undefined || to === undefined) {
    return
  }

  const fromTime = Date.parse(from)
  const toTime = Date.parse(to)
  const maximumRange = 366 * 24 * 60 * 60 * 1000

  if (!(fromTime < toTime) || toTime - fromTime > maximumRange) {
    throw new Error('date range는 From < To이고 최대 366일이어야 합니다.')
  }
}

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue }

export const normalizePhase7OptionComparison = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(LEADING_UNICODE_WHITESPACE_PATTERN, '')
    .replace(TRAILING_UNICODE_WHITESPACE_PATTERN, '')
    .replace(UNICODE_WHITESPACE_RUN_PATTERN, ' ')

export const canonicalizeJson = (value: CanonicalJsonValue): string => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonical JSON number는 finite여야 합니다.')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`
  }

  const record = value as { readonly [key: string]: CanonicalJsonValue }
  const entries = Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key] ?? null)}`
    )
  return `{${entries.join(',')}}`
}

export interface Sha256TextPort {
  readonly digestUtf8: (value: string) => Promise<string>
}

export const sha256Text = async (
  port: Sha256TextPort,
  value: string
): Promise<string> => sha256HexSchema.parse(await port.digestUtf8(value))

export const sha256DomainSeparated = async (
  port: Sha256TextPort,
  domain: string,
  payload: string
): Promise<string> => sha256Text(port, `${domain}\u0000${payload}`)

export type AccountActorSnapshot = z.output<typeof accountActorSnapshotSchema>
export type AdminActorSnapshot = z.output<typeof adminActorSnapshotSchema>
export type SafeActorSnapshot = z.output<typeof safeActorSnapshotSchema>
export type QuestionLifecycleStatus = z.output<
  typeof questionLifecycleStatusSchema
>
export type QuestionVersionStatus = z.output<typeof questionVersionStatusSchema>
export type RetirementKind = z.output<typeof retirementKindSchema>
