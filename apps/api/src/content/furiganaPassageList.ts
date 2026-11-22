import { createHash } from 'node:crypto'
import { z } from 'zod'
import { parseRuby } from './furiganaRuby.js'

/**
 * #1182: content/furigana/reading-passages.v1.json, one entry per reading
 * passage (level, subject and the md5 of its text, the "ReadingPassage" key).
 * The generator writes AUTO entries; a reviewer corrects the ruby and fills
 * reviewedBy and reviewedAt, after which the generator keeps the entry as is.
 */
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const SUBJECTS = ['VOCABULARY', 'GRAMMAR', 'READING'] as const

const entrySchema = z
  .object({
    level: z.enum(LEVELS),
    subject: z.enum(SUBJECTS),
    textMd5: z.string().regex(/^[0-9a-f]{32}$/u),
    ruby: z.string().min(1),
    reviewedBy: z.string().trim().min(1).max(64).nullable(),
    reviewedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable()
  })
  .strict()
  .superRefine((entry, context) => {
    if ((entry.reviewedBy === null) !== (entry.reviewedAt === null)) {
      context.addIssue({
        code: 'custom',
        message: 'reviewedBy and reviewedAt go together.'
      })
    }
    try {
      if (md5(parseRuby(entry.ruby).text) !== entry.textMd5) {
        context.addIssue({
          code: 'custom',
          message: 'ruby text does not match textMd5.'
        })
      }
    } catch (error) {
      context.addIssue({ code: 'custom', message: String(error) })
    }
  })

const listSchema = z
  .object({
    schemaVersion: z.literal(1),
    generator: z.string().min(1),
    passages: z.array(entrySchema)
  })
  .strict()

export type FuriganaPassageEntry = z.infer<typeof entrySchema>
export type FuriganaPassageList = z.infer<typeof listSchema>

export type ImportedPassage = {
  level: FuriganaPassageEntry['level']
  subject: FuriganaPassageEntry['subject']
  text: string
}

export const md5 = (text: string): string =>
  createHash('md5').update(text, 'utf8').digest('hex')

const keyOf = (entry: {
  level: string
  subject: string
  textMd5: string
}): string => `${entry.level}/${entry.subject}/${entry.textMd5}`

/** Parses the list bytes; any format error rejects the whole file. */
export const parseFuriganaPassageList = (
  bytes: Uint8Array | string
): FuriganaPassageList => {
  const list = listSchema.parse(
    JSON.parse(
      typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')
    )
  )
  const seen = new Set<string>()
  for (const entry of list.passages) {
    if (seen.has(keyOf(entry))) {
      throw new Error(`Duplicate passage ${keyOf(entry)}.`)
    }
    seen.add(keyOf(entry))
  }
  return list
}

/** The passages of the question import files, once each, in file order. */
export const collectImportedPassages = (
  files: readonly unknown[]
): ImportedPassage[] => {
  const itemSchema = z.object({
    content: z.object({
      level: z.enum(LEVELS),
      subject: z.enum(SUBJECTS),
      passage: z.string().nullable().optional()
    })
  })
  const fileSchema = z.object({ items: z.array(itemSchema) })
  const seen = new Set<string>()
  const passages: ImportedPassage[] = []
  for (const file of files) {
    for (const { content } of fileSchema.parse(file).items) {
      if (content.passage == null) continue
      const key = keyOf({ ...content, textMd5: md5(content.passage) })
      if (seen.has(key)) continue
      seen.add(key)
      passages.push({
        level: content.level,
        subject: content.subject,
        text: content.passage
      })
    }
  }
  return passages
}

/**
 * The next list: reviewed entries stay as they are; every other imported
 * passage gets a fresh draft, or a copy of a reviewed entry with the same
 * text as its first value. Unreviewed entries no import holds any more drop.
 */
export const planFuriganaPassageList = (
  imported: readonly ImportedPassage[],
  current: FuriganaPassageList | null,
  draft: (text: string) => string,
  generator: string
): FuriganaPassageList => {
  const reviewed = new Map(
    (current?.passages ?? [])
      .filter((entry) => entry.reviewedBy !== null)
      .map((entry) => [keyOf(entry), entry])
  )
  const reviewedRuby = new Map(
    [...reviewed.values()].map((entry) => [entry.textMd5, entry.ruby])
  )
  const passages: FuriganaPassageEntry[] = imported.map((passage) => {
    const textMd5 = md5(passage.text)
    const kept = reviewed.get(keyOf({ ...passage, textMd5 }))
    if (kept) return kept
    return {
      level: passage.level,
      subject: passage.subject,
      textMd5,
      ruby: reviewedRuby.get(textMd5) ?? draft(passage.text),
      reviewedBy: null,
      reviewedAt: null
    }
  })
  const listed = new Set(passages.map(keyOf))
  for (const entry of reviewed.values()) {
    if (!listed.has(keyOf(entry))) passages.push(entry)
  }
  return { schemaVersion: 1, generator, passages }
}
