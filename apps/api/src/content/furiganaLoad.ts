import type { FuriganaSegment } from './furiganaRuby.js'
import { parseRuby } from './furiganaRuby.js'
import type { FuriganaPassageList } from './furiganaPassageList.js'

/**
 * #1182: loads the reviewed entries of reading-passages.v1.json into
 * "Furigana" as REVIEWED passage rows. The file is the whole list: a passage
 * row whose entry left the file or is no longer reviewed is deleted. An entry
 * whose passage is not in this database is skipped and counted.
 */
export interface FuriganaPassageRow {
  readonly passageId: string
  readonly level: string
  readonly subject: string
  readonly textMd5: string
  readonly furiganaId: string | null
  readonly segments: unknown
  readonly reviewedBy: string | null
  /** YYYY-MM-DD (UTC) */
  readonly reviewedAt: string | null
}

export interface FuriganaPassageLoad {
  readonly passageId: string
  readonly textMd5: string
  readonly segments: readonly FuriganaSegment[]
  readonly reviewedBy: string
  readonly reviewedAt: string
}

export type FuriganaLoadStep =
  | { readonly kind: 'create'; readonly row: FuriganaPassageLoad }
  | {
      readonly kind: 'update'
      readonly id: string
      readonly row: FuriganaPassageLoad
    }
  | { readonly kind: 'delete'; readonly id: string }

export interface FuriganaLoadPlan {
  readonly steps: readonly FuriganaLoadStep[]
  readonly unchanged: number
  readonly reviewed: number
  readonly missingPassage: number
}

const keyOf = (entry: {
  level: string
  subject: string
  textMd5: string
}): string => `${entry.level}/${entry.subject}/${entry.textMd5}`

const sameSegments = (
  stored: unknown,
  segments: readonly FuriganaSegment[]
): boolean =>
  Array.isArray(stored) &&
  stored.length === segments.length &&
  segments.every((segment, index) => {
    const row = stored[index] as Partial<FuriganaSegment> | undefined
    return (
      row?.start === segment.start &&
      row.length === segment.length &&
      row.reading === segment.reading
    )
  })

export const planFuriganaLoad = (
  list: FuriganaPassageList,
  rows: readonly FuriganaPassageRow[]
): FuriganaLoadPlan => {
  const byKey = new Map(rows.map((row) => [keyOf(row), row]))
  const reviewed = list.passages.filter((entry) => entry.reviewedBy !== null)
  const wanted = new Set<string>()
  const steps: FuriganaLoadStep[] = []
  const loads: FuriganaLoadStep[] = []
  let unchanged = 0
  let missingPassage = 0
  for (const entry of reviewed) {
    const row = byKey.get(keyOf(entry))
    if (!row) {
      missingPassage += 1
      continue
    }
    wanted.add(row.passageId)
    const load: FuriganaPassageLoad = {
      passageId: row.passageId,
      textMd5: row.textMd5,
      segments: parseRuby(entry.ruby).segments,
      reviewedBy: entry.reviewedBy ?? '',
      reviewedAt: entry.reviewedAt ?? ''
    }
    if (row.furiganaId === null) loads.push({ kind: 'create', row: load })
    else if (
      sameSegments(row.segments, load.segments) &&
      row.reviewedBy === load.reviewedBy &&
      row.reviewedAt === load.reviewedAt
    )
      unchanged += 1
    else loads.push({ kind: 'update', id: row.furiganaId, row: load })
  }
  for (const row of rows) {
    if (row.furiganaId !== null && !wanted.has(row.passageId)) {
      steps.push({ kind: 'delete', id: row.furiganaId })
    }
  }
  return {
    steps: [...steps, ...loads],
    unchanged,
    reviewed: reviewed.length,
    missingPassage
  }
}

/** Every passage with its furigana row, if any. */
export const FURIGANA_PASSAGE_ROWS_SQL = `SELECT passage."id"::text AS "passageId",
    passage."level"::text AS "level", passage."subject"::text AS "subject",
    passage."textMd5", furigana."id"::text AS "furiganaId",
    furigana."segments", furigana."reviewedBy",
    to_char(furigana."reviewedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      AS "reviewedAt"
  FROM "ReadingPassage" AS passage
  LEFT JOIN "Furigana" AS furigana ON furigana."passageId" = passage."id"
  ORDER BY passage."id"`

const DELETE_SQL = `DELETE FROM "Furigana" WHERE "id" = $1::uuid`

const UPDATE_SQL = `UPDATE "Furigana" SET "textMd5" = $2, "segments" = $3::jsonb,
    "origin" = 'REVIEWED', "reviewedBy" = $4,
    "reviewedAt" = ($5::date)::timestamp AT TIME ZONE 'UTC',
    "updatedAt" = clock_timestamp()
  WHERE "id" = $1::uuid AND "target" = 'PASSAGE'`

const INSERT_SQL = `INSERT INTO "Furigana" ("target", "passageId", "textMd5",
    "segments", "origin", "reviewedBy", "reviewedAt")
  VALUES ('PASSAGE', $1::uuid, $2, $3::jsonb, 'REVIEWED', $4,
    ($5::date)::timestamp AT TIME ZONE 'UTC')`

/** Runs one statement and returns its row count. */
export type FuriganaExecute = (
  sql: string,
  values: readonly unknown[]
) => Promise<number>

/** Applies a plan's steps in order; any step that misses its row throws. */
export const applyFuriganaLoad = async (
  execute: FuriganaExecute,
  plan: FuriganaLoadPlan
): Promise<void> => {
  for (const step of plan.steps) {
    const values =
      step.kind === 'delete'
        ? [step.id]
        : [
            ...(step.kind === 'update' ? [step.id] : [step.row.passageId]),
            step.row.textMd5,
            JSON.stringify(step.row.segments),
            step.row.reviewedBy,
            step.row.reviewedAt
          ]
    const sql =
      step.kind === 'delete'
        ? DELETE_SQL
        : step.kind === 'update'
          ? UPDATE_SQL
          : INSERT_SQL
    if ((await execute(sql, values)) !== 1) {
      throw new Error('FURIGANA_LOAD_RESULT_INVALID')
    }
  }
}

export const countFuriganaSteps = (
  plan: FuriganaLoadPlan,
  kind: FuriganaLoadStep['kind']
): number => plan.steps.filter((step) => step.kind === kind).length
