import { createHash } from 'node:crypto'
import { normalizeTagKey } from '@nihongo/domain/content/validators/v1/unicode'
import { z } from 'zod'

export type TagSubject = 'VOCABULARY' | 'GRAMMAR' | 'READING'
export type TagStatus = 'ACTIVE' | 'RETIRED'

// The key prefix names the subject so a key alone shows where it belongs.
const SUBJECT_BY_PREFIX: Readonly<Record<string, TagSubject>> = {
  vocab: 'VOCABULARY',
  grammar: 'GRAMMAR',
  reading: 'READING'
}

// Same pattern as the "Tag_key_format_check" constraint.
const TAG_KEY_PATTERN = /^[a-z]+\.[a-z0-9]+(-[a-z0-9]+)*$/u

const tagEntrySchema = z.strictObject({
  key: z.string().max(64).regex(TAG_KEY_PATTERN),
  label: z
    .string()
    .max(40)
    .refine((value) => normalizeTagKey(value) !== ''),
  subject: z.enum(['VOCABULARY', 'GRAMMAR', 'READING']),
  status: z.enum(['ACTIVE', 'RETIRED']),
  // #976: the Japanese name; absent means the Korean label is shown.
  labelJa: z
    .string()
    .max(40)
    .refine((value) => value.trim() !== '')
    .optional()
})

const tagListSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    tags: z.array(tagEntrySchema).min(1).max(200)
  })
  .superRefine(({ tags }, context) => {
    const keys = new Set<string>()
    const names = new Set<string>()
    tags.forEach((tag, index) => {
      const name = normalizeTagKey(tag.label)
      if (SUBJECT_BY_PREFIX[tag.key.split('.')[0] ?? ''] !== tag.subject) {
        context.addIssue({
          code: 'custom',
          path: ['tags', index, 'subject'],
          message: 'TAG_KEY_SUBJECT_MISMATCH'
        })
      }
      if (keys.has(tag.key) || names.has(name)) {
        context.addIssue({
          code: 'custom',
          path: ['tags', index],
          message: 'TAG_DUPLICATE'
        })
      }
      keys.add(tag.key)
      names.add(name)
    })
  })

export interface TagListEntry {
  readonly key: string
  readonly label: string
  readonly normalizedName: string
  readonly subject: TagSubject
  readonly status: TagStatus
  readonly labelJa: string | null
}

export interface TagList {
  readonly sha256: string
  readonly tags: readonly TagListEntry[]
}

/** Parses tags.v2.json bytes; any format error rejects the whole file. */
export const parseTagList = (bytes: Uint8Array): TagList => {
  const parsed = tagListSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  )
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    tags: parsed.tags.map((tag) => ({
      ...tag,
      label: tag.label.trim(),
      normalizedName: normalizeTagKey(tag.label),
      labelJa: tag.labelJa?.trim() ?? null
    }))
  }
}

export interface TagRow {
  readonly id: string
  readonly key: string | null
  readonly label: string
  readonly normalizedName: string
  readonly subject: TagSubject | null
  readonly status: TagStatus | null
  readonly labelJa: string | null
}

export type TagLoadStep =
  | { readonly kind: 'create'; readonly tag: TagListEntry }
  | {
      readonly kind: 'update' | 'claim'
      readonly id: string
      readonly tag: TagListEntry
    }

export interface TagLoadPlan {
  readonly steps: readonly TagLoadStep[]
  readonly unchanged: number
  readonly conflicts: readonly string[]
  readonly notInFile: number
  readonly unkeyed: number
}

/**
 * Matches file tags to rows by key. A row without a key and with the same
 * name is claimed, so tags loaded before keys existed keep their id. A name
 * held by a different row is a conflict, and nothing is deleted.
 */
export const planTagLoad = (
  list: TagList,
  rows: readonly TagRow[]
): TagLoadPlan => {
  const byKey = new Map(
    rows.flatMap((row) => (row.key ? [[row.key, row]] : []))
  )
  const byName = new Map(rows.map((row) => [row.normalizedName, row]))
  const steps: TagLoadStep[] = []
  const conflicts: string[] = []
  let unchanged = 0
  for (const tag of list.tags) {
    const keyed = byKey.get(tag.key)
    const named = byName.get(tag.normalizedName)
    if (keyed) {
      if (named && named.id !== keyed.id) {
        conflicts.push(tag.key)
      } else if (
        keyed.label === tag.label &&
        keyed.normalizedName === tag.normalizedName &&
        keyed.subject === tag.subject &&
        keyed.status === tag.status &&
        keyed.labelJa === tag.labelJa
      ) {
        unchanged += 1
      } else {
        steps.push({ kind: 'update', id: keyed.id, tag })
      }
    } else if (named) {
      if (named.key === null) {
        steps.push({ kind: 'claim', id: named.id, tag })
      } else {
        conflicts.push(tag.key)
      }
    } else {
      steps.push({ kind: 'create', tag })
    }
  }
  const fileKeys = new Set(list.tags.map((tag) => tag.key))
  const claimed = new Set(
    steps.flatMap((step) => (step.kind === 'claim' ? [step.id] : []))
  )
  return {
    steps,
    unchanged,
    conflicts,
    notInFile: rows.filter((row) => row.key && !fileKeys.has(row.key)).length,
    unkeyed: rows.filter((row) => !row.key && !claimed.has(row.id)).length
  }
}
