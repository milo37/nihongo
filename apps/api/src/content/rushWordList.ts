import { createHash } from 'node:crypto'
import { RUSH_PAIRS_MIN } from '@nihongo/contracts/study/rush-pairs'
import { z } from 'zod'

export type RushLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1'

const LEVELS: readonly RushLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']

// Same patterns as the "RushKanjiWord" checks.
const SOURCE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u
const KANJI_PATTERN = /[一-鿿々]/u
const CONJUGATION_TAIL_PATTERN = /(ます|ました|ません|て|で|た|だ)$/u
const HIRAGANA_PATTERN = /^[ぁ-ゖー]{1,16}$/u

const hiraganaSchema = z.string().regex(HIRAGANA_PATTERN)

const rushWordSchema = z
  .strictObject({
    level: z.enum(LEVELS),
    word: z
      .string()
      .min(1)
      .max(8)
      .regex(KANJI_PATTERN)
      .refine((word) => !/\s/u.test(word), 'RUSH_WORD_SPACE')
      .refine(
        (word) => !CONJUGATION_TAIL_PATTERN.test(word),
        'RUSH_WORD_CONJUGATED'
      ),
    reading: hiraganaSchema,
    wrong: z.tuple([hiraganaSchema, hiraganaSchema, hiraganaSchema]),
    source: z.string().regex(SOURCE_KEY_PATTERN)
  })
  .refine(
    ({ reading, wrong }) => new Set([reading, ...wrong]).size === 4,
    'RUSH_WORD_READING_DUPLICATE'
  )

const rushWordListSchema = z
  .strictObject({
    version: z.literal(1),
    items: z.array(rushWordSchema).min(1).max(2000)
  })
  .superRefine(({ items }, context) => {
    const sources = new Set<string>()
    const words = new Set<string>()
    items.forEach((item, index) => {
      const word = `${item.level}:${item.word}`
      if (sources.has(item.source) || words.has(word)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index],
          message: 'RUSH_WORD_DUPLICATE'
        })
      }
      sources.add(item.source)
      words.add(word)
    })
    for (const level of LEVELS) {
      if (items.filter((item) => item.level === level).length < RUSH_PAIRS_MIN)
        context.addIssue({
          code: 'custom',
          path: ['items'],
          message: `RUSH_LEVEL_TOO_FEW:${level}`
        })
    }
  })

export interface RushWord {
  readonly sourceKey: string
  readonly level: RushLevel
  readonly word: string
  readonly reading: string
  readonly wrong: readonly [string, string, string]
}

export interface RushWordList {
  readonly sha256: string
  readonly words: readonly RushWord[]
}

/** Parses kanji-words.v1.json bytes; any format error rejects the whole file. */
export const parseRushWordList = (bytes: Uint8Array): RushWordList => {
  const parsed = rushWordListSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  )
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    words: parsed.items.map(({ source, level, word, reading, wrong }) => ({
      sourceKey: source,
      level,
      word,
      reading,
      wrong
    }))
  }
}

export interface RushWordRow extends Omit<RushWord, 'wrong'> {
  readonly id: string
  readonly wrong: readonly string[]
}

export type RushWordLoadStep =
  | { readonly kind: 'create'; readonly word: RushWord }
  | { readonly kind: 'update'; readonly id: string; readonly word: RushWord }
  | { readonly kind: 'delete'; readonly id: string }

export interface RushWordLoadPlan {
  readonly steps: readonly RushWordLoadStep[]
  readonly unchanged: number
}

const sameWord = (row: RushWordRow, word: RushWord): boolean =>
  row.level === word.level &&
  row.word === word.word &&
  row.reading === word.reading &&
  row.wrong.join('\n') === word.wrong.join('\n')

/**
 * Matches file words to rows by source key. The file is the whole list: a
 * row whose key left the file is deleted (no other table refers to it).
 * Deletes come first so a word can move to another key in one load.
 */
export const planRushWordLoad = (
  list: RushWordList,
  rows: readonly RushWordRow[]
): RushWordLoadPlan => {
  const byKey = new Map(rows.map((row) => [row.sourceKey, row]))
  const fileKeys = new Set(list.words.map((word) => word.sourceKey))
  const steps: RushWordLoadStep[] = rows
    .filter((row) => !fileKeys.has(row.sourceKey))
    .map((row) => ({ kind: 'delete', id: row.id }))
  let unchanged = 0
  for (const word of list.words) {
    const row = byKey.get(word.sourceKey)
    if (!row) steps.push({ kind: 'create', word })
    else if (sameWord(row, word)) unchanged += 1
    else steps.push({ kind: 'update', id: row.id, word })
  }
  return { steps, unchanged }
}

export const RUSH_WORD_ROWS_SQL = `SELECT "id"::text AS "id", "sourceKey",
    "level"::text AS "level", "word", "reading", "wrong"
  FROM "RushKanjiWord" ORDER BY "sourceKey"`

const DELETE_SQL = `DELETE FROM "RushKanjiWord" WHERE "id" = $1::uuid`

const UPDATE_SQL = `UPDATE "RushKanjiWord" SET "level" = $2::"JlptLevel",
    "word" = $3, "reading" = $4, "wrong" = $5::text[],
    "updatedAt" = clock_timestamp()
  WHERE "id" = $1::uuid`

const INSERT_SQL = `INSERT INTO "RushKanjiWord" ("sourceKey", "level", "word",
    "reading", "wrong")
  VALUES ($1, $2::"JlptLevel", $3, $4, $5::text[])`

/** Runs one statement and returns its row count. */
export type RushWordExecute = (
  sql: string,
  values: readonly unknown[]
) => Promise<number>

/** Applies a plan's steps in order; any step that misses its row throws. */
export const applyRushWordLoad = async (
  execute: RushWordExecute,
  plan: RushWordLoadPlan
): Promise<void> => {
  for (const step of plan.steps) {
    const count =
      step.kind === 'delete'
        ? await execute(DELETE_SQL, [step.id])
        : step.kind === 'update'
          ? await execute(UPDATE_SQL, [
              step.id,
              step.word.level,
              step.word.word,
              step.word.reading,
              [...step.word.wrong]
            ])
          : await execute(INSERT_SQL, [
              step.word.sourceKey,
              step.word.level,
              step.word.word,
              step.word.reading,
              [...step.word.wrong]
            ])
    if (count !== 1) throw new Error('RUSH_WORD_LOAD_RESULT_INVALID')
  }
}

export const countRushWordSteps = (
  plan: RushWordLoadPlan,
  kind: RushWordLoadStep['kind']
): number => plan.steps.filter((step) => step.kind === kind).length
