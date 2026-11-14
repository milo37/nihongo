import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  createAdminQuestionVersionRequestSchema,
  normalizeContentTagKey,
  type CreateAdminQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createPrismaAdminQuestionCommandRepository } from '../admin/adminQuestionCommandRepository.js'
import {
  createAdminQuestionCommandService,
  createAdminQuestionPublicationCommandService,
  createAdminQuestionWorkflowCommandService
} from '../admin/adminQuestionCommandService.js'
import { createPrismaAdminQuestionWorkflowRepository } from '../admin/adminQuestionWorkflowRepository.js'
import { contentFingerprint } from '../admin/adminQuestionWorkflowImport.js'
import { createOperatorAdminAuthority } from '../admin/operatorAdminAuthority.js'
import {
  ACTOR_SQL,
  chunk,
  OPEN_STAGE,
  QuestionSetInputError,
  type QuestionSetFile
} from './questionSetPublish.js'

/**
 * The Japanese explanation file planning hands over (#976). An item may also
 * carry a corrected Korean explanation, which the new version takes too.
 */
const explanationFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z
      .array(
        z
          .object({
            clientItemId: z.string().min(1),
            explanationJa: z.string().min(1),
            explanationKo: z.string().min(1).optional()
          })
          .strict()
      )
      .min(1)
  })
  .strict()

export interface ExplanationJaFile {
  readonly sha256: string
  readonly items: ReadonlyArray<{
    clientItemId: string
    explanationJa: string
    explanationKo?: string | undefined
  }>
}

/** Reads the file; a duplicate clientItemId refuses the run. */
export const readExplanationJaFile = async (
  path: string
): Promise<ExplanationJaFile> => {
  const bytes = await readFile(path)
  const parsed = explanationFileSchema.safeParse(
    JSON.parse(bytes.toString('utf8'))
  )
  if (!parsed.success) {
    throw new QuestionSetInputError('EXPLANATION_JA_FILE_INVALID')
  }
  const ids = parsed.data.items.map(({ clientItemId }) => clientItemId)
  if (new Set(ids).size !== ids.length) {
    throw new QuestionSetInputError('EXPLANATION_JA_FILE_INVALID')
  }
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    items: parsed.data.items
  }
}

type Stage = 'CREATE' | 'REVIEW_REQUEST' | 'APPROVAL' | 'PUBLICATION'

interface VersionRow {
  readonly fingerprint: string
  readonly questionId: string
  readonly versionId: string
  readonly status: string
  readonly rowVersion: number
  readonly lifecycleStatus: string
  readonly questionRowVersion: number
  readonly currentPublishedVersionId: string | null
  readonly level: string
  readonly difficulty: string
  readonly explanationKo: string
  readonly explanationJa: string | null
  readonly questionText: string
  readonly passage: string | null
  readonly optionTexts: string[]
  readonly correctOptionText: string | null
  readonly tagCount: number
  readonly tagKeys: string[]
}

interface PlannedItem {
  readonly clientItemId: string
  readonly stage: Stage | 'PUBLISHED'
  readonly questionId: string
  readonly questionRowVersion: number
  readonly versionId: string | null
  readonly rowVersion: number | null
}

export interface ExplanationJaConflict {
  readonly clientItemId: string
  readonly reason: string
}

export interface ExplanationJaFailure {
  readonly stage: Stage
  readonly clientItemId: string | null
  readonly questionVersionId: string | null
  readonly result: string
}

export interface ExplanationJaReport {
  readonly runId: string
  readonly execute: boolean
  readonly fileSha256: string
  readonly items: number
  readonly pending: Readonly<Record<Stage, number>>
  readonly created: number
  readonly reviewRequested: number
  readonly approved: number
  readonly published: number
  readonly skippedPublished: number
  readonly conflicts: readonly ExplanationJaConflict[]
  readonly failures: readonly ExplanationJaFailure[]
}

// Each tag is matched by its key or its normalized name, like the import.
const STATE_SQL = `SELECT version."contentFingerprint" AS "fingerprint",
    version."questionId",
    version."id" AS "versionId",
    version."status"::text AS "status",
    version."rowVersion",
    question."lifecycleStatus"::text AS "lifecycleStatus",
    question."rowVersion" AS "questionRowVersion",
    question."currentPublishedVersionId",
    version."level"::text AS "level",
    version."difficulty"::text AS "difficulty",
    version."explanationKo",
    version."explanationJa",
    version."questionText",
    version."passage",
    COALESCE((
      SELECT array_agg(option."text" ORDER BY option."ordinal", option."id")
      FROM "QuestionOption" AS option
      WHERE option."questionVersionId" = version."id"
    ), ARRAY[]::text[]) AS "optionTexts",
    (SELECT option."text" FROM "QuestionOption" AS option
      WHERE option."id" = version."correctOptionId") AS "correctOptionText",
    (SELECT count(*)::int FROM "QuestionVersionTag" AS assignment
      WHERE assignment."questionVersionId" = version."id") AS "tagCount",
    COALESCE((
      SELECT array_agg(ref ORDER BY ref)
      FROM "QuestionVersionTag" AS assignment
      JOIN "Tag" AS tag ON tag."id" = assignment."tagId"
      CROSS JOIN LATERAL unnest(
        ARRAY[tag."key", tag."normalizedName"]
      ) AS ref
      WHERE assignment."questionVersionId" = version."id" AND ref IS NOT NULL
    ), ARRAY[]::text[]) AS "tagKeys"
  FROM "QuestionVersion" AS version
  JOIN "Question" AS question ON question."id" = version."questionId"
  WHERE version."contentFingerprint" = ANY($1::varchar[])
  ORDER BY version."id"`

interface Entry {
  readonly clientItemId: string
  readonly fingerprint: string
  /** The set item with only the explanations replaced, normalized. */
  readonly request: CreateAdminQuestionVersionRequest
  /** The set item's own Korean explanation, normalized. */
  readonly importedExplanationKo: string
}

// The fingerprint normalizes text and sorts the options, so the new version
// must also keep the exact question text, passage, option order, answer,
// level, difficulty, Korean explanation and tags. A version an admin changed
// since the import is left to a person. The Korean explanation may be the
// imported one or the file's correction.
const keepsSetContent = (row: VersionRow, entry: Entry): boolean =>
  row.questionText === entry.request.questionText &&
  row.passage === entry.request.passage &&
  JSON.stringify(row.optionTexts) ===
    JSON.stringify(entry.request.options.map(({ text }) => text)) &&
  row.correctOptionText ===
    entry.request.options.find(
      ({ clientOptionKey }) =>
        clientOptionKey === entry.request.correctOptionKey
    )?.text &&
  row.level === entry.request.level &&
  row.difficulty === entry.request.difficulty &&
  (row.explanationKo === entry.importedExplanationKo ||
    row.explanationKo === entry.request.explanationKo) &&
  row.tagCount === entry.request.tagNames.length &&
  entry.request.tagNames.every((name) =>
    row.tagKeys.includes(normalizeContentTagKey(name))
  )

/**
 * Plans every explanation from its set item's fingerprint. The question's
 * published version already carrying the explanation is skipped; an open
 * version carrying it continues from its next step; a published version
 * without it gets a new version. Anything else (no published version, an open
 * version with other content, changes requested, several questions, content
 * changed since the import) is a conflict a person must decide.
 */
const planItems = async (
  client: PrismaClient,
  entries: readonly Entry[]
): Promise<{ items: PlannedItem[]; conflicts: ExplanationJaConflict[] }> => {
  const rows = await client.$queryRawUnsafe<VersionRow[]>(
    STATE_SQL,
    entries.map(({ fingerprint }) => fingerprint)
  )
  const byFingerprint = new Map<string, VersionRow[]>()
  for (const row of rows)
    byFingerprint.set(row.fingerprint, [
      ...(byFingerprint.get(row.fingerprint) ?? []),
      row
    ])
  const items: PlannedItem[] = []
  const conflicts: ExplanationJaConflict[] = []
  for (const entry of entries) {
    const { clientItemId, fingerprint } = entry
    const explanationJa = entry.request.explanationJa
    const versions = byFingerprint.get(fingerprint) ?? []
    const conflict = (reason: string) =>
      conflicts.push({ clientItemId, reason })
    const questionIds = new Set(versions.map((row) => row.questionId))
    const published = versions.find(
      (row) => row.currentPublishedVersionId === row.versionId
    )
    if (questionIds.size !== 1 || !published) {
      conflict(questionIds.size > 1 ? 'SEVERAL_QUESTIONS' : 'NOT_PUBLISHED')
      continue
    }
    const target = {
      clientItemId,
      questionId: published.questionId,
      questionRowVersion: published.questionRowVersion
    }
    if (
      published.explanationJa === explanationJa &&
      published.explanationKo === entry.request.explanationKo
    ) {
      items.push({
        ...target,
        stage: 'PUBLISHED',
        versionId: published.versionId,
        rowVersion: published.rowVersion
      })
      continue
    }
    if (published.lifecycleStatus !== 'ACTIVE') {
      conflict(`QUESTION_${published.lifecycleStatus}`)
      continue
    }
    const candidates = versions.filter(
      (row) =>
        row.versionId !== published.versionId &&
        ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(
          row.status
        )
    )
    const [candidate] = candidates
    if (candidates.length > 1) {
      conflict('SEVERAL_OPEN_VERSIONS')
      continue
    }
    if (candidate) {
      const stage = OPEN_STAGE[candidate.status]
      if (
        !stage ||
        candidate.explanationJa !== explanationJa ||
        candidate.explanationKo !== entry.request.explanationKo ||
        !keepsSetContent(candidate, entry)
      ) {
        conflict(`OPEN_VERSION_${candidate.status}`)
        continue
      }
      items.push({
        ...target,
        stage,
        versionId: candidate.versionId,
        rowVersion: candidate.rowVersion
      })
      continue
    }
    if (!keepsSetContent(published, entry)) {
      conflict('PUBLISHED_CONTENT_CHANGED')
      continue
    }
    items.push({
      ...target,
      stage: 'CREATE',
      versionId: null,
      rowVersion: null
    })
  }
  return { items, conflicts }
}

const countStage = (
  items: readonly PlannedItem[],
  stage: PlannedItem['stage']
): number => items.filter((item) => item.stage === stage).length

/**
 * Publishes a new version of each question with its Japanese explanation, as
 * the one ACTIVE ADMIN through the admin command services (#976): create,
 * request review, approve, publish. Without `execute` it only plans. The set
 * files locate each question by its import item. Every audit row of one run
 * carries `runId` as its request id; a rerun continues where an earlier run
 * stopped and skips what is already published.
 */
export const publishExplanationJa = async ({
  auditEnvironment,
  client,
  execute,
  explanations,
  files,
  runId = randomUUID()
}: {
  readonly auditEnvironment: 'TEST' | 'DEVELOPMENT' | 'PRODUCTION'
  readonly client: PrismaClient
  readonly execute: boolean
  readonly explanations: ExplanationJaFile
  readonly files: readonly QuestionSetFile[]
  readonly runId?: string
}): Promise<ExplanationJaReport> => {
  const setItems = new Map(
    files.flatMap((file) => file.items.map((item) => [item.clientItemId, item]))
  )
  const conflicts: ExplanationJaConflict[] = []
  const entries: Entry[] = []
  for (const {
    clientItemId,
    explanationJa,
    explanationKo
  } of explanations.items) {
    const item = setItems.get(clientItemId)
    if (!item) {
      conflicts.push({ clientItemId, reason: 'NOT_IN_QUESTION_SET' })
      continue
    }
    // Validates and normalizes like the admin screen before any write.
    const imported = createAdminQuestionVersionRequestSchema.safeParse({
      ...item.content,
      explanationJa,
      expectedQuestionRowVersion: 1
    })
    const parsed =
      explanationKo === undefined
        ? imported
        : createAdminQuestionVersionRequestSchema.safeParse({
            ...item.content,
            explanationJa,
            explanationKo,
            expectedQuestionRowVersion: 1
          })
    if (
      !imported.success ||
      !parsed.success ||
      parsed.data.explanationJa === null
    ) {
      conflicts.push({ clientItemId, reason: 'EXPLANATION_JA_INVALID' })
      continue
    }
    entries.push({
      clientItemId,
      fingerprint: contentFingerprint(item.content),
      request: parsed.data,
      importedExplanationKo: imported.data.explanationKo
    })
  }

  const admins = await client.$queryRawUnsafe<Array<{ id: string }>>(ACTOR_SQL)
  const actor = admins.length === 1 ? admins[0] : undefined
  if (!actor) throw new QuestionSetInputError('QUESTION_SET_ACTOR_INVALID')

  const initial = await planItems(client, entries)
  conflicts.push(...initial.conflicts)
  const pending: Record<Stage, number> = {
    CREATE: countStage(initial.items, 'CREATE'),
    REVIEW_REQUEST: countStage(initial.items, 'REVIEW_REQUEST'),
    APPROVAL: countStage(initial.items, 'APPROVAL'),
    PUBLICATION: countStage(initial.items, 'PUBLICATION')
  }
  const failures: ExplanationJaFailure[] = []
  const counts = { created: 0, reviewRequested: 0, approved: 0, published: 0 }
  const report = (): ExplanationJaReport => ({
    runId,
    execute,
    fileSha256: explanations.sha256,
    items: explanations.items.length,
    pending,
    ...counts,
    skippedPublished: countStage(initial.items, 'PUBLISHED'),
    conflicts,
    failures
  })
  if (!execute || conflicts.length > 0) return report()

  const commandRepository = createPrismaAdminQuestionCommandRepository({
    auditEnvironment,
    client
  })
  const commands = {
    ...createAdminQuestionCommandService(commandRepository),
    ...createAdminQuestionPublicationCommandService(commandRepository),
    ...createAdminQuestionWorkflowCommandService(
      createPrismaAdminQuestionWorkflowRepository({ auditEnvironment, client })
    )
  }
  const authority = createOperatorAdminAuthority({
    actorId: actor.id,
    requestId: runId
  })
  const replan = async (stage: Stage) =>
    (await planItems(client, entries)).items.filter(
      (item) => item.stage === stage
    )

  const byId = new Map(entries.map((entry) => [entry.clientItemId, entry]))
  for (const planned of await replan('CREATE')) {
    const entry = byId.get(planned.clientItemId)!
    try {
      await commands.createVersion(authority, planned.questionId, {
        ...entry.request,
        expectedQuestionRowVersion: planned.questionRowVersion
      })
      counts.created += 1
    } catch (error: unknown) {
      failures.push({
        stage: 'CREATE',
        clientItemId: planned.clientItemId,
        questionVersionId: null,
        result:
          error instanceof Error && 'code' in error
            ? String(error.code)
            : 'CREATE_FAILED'
      })
    }
  }

  for (const batch of chunk(await replan('REVIEW_REQUEST'), 20)) {
    const result = await commands.requestReviewBatch(authority, {
      items: batch.map((item) => ({
        versionId: item.versionId as string,
        expectedRowVersion: item.rowVersion as number
      }))
    })
    counts.reviewRequested += result.items.length
  }

  for (const batch of chunk(await replan('APPROVAL'), 100)) {
    const result = await commands.approveVersionBatch(authority, {
      items: batch.map((item) => ({
        questionVersionId: item.versionId as string,
        expectedRowVersion: item.rowVersion as number
      }))
    })
    counts.approved += result.approvedCount
    for (const item of result.items)
      if (item.result !== 'APPROVED')
        failures.push({
          stage: 'APPROVAL',
          clientItemId: null,
          questionVersionId: item.questionVersionId,
          result: item.result
        })
  }

  for (const batch of chunk(await replan('PUBLICATION'), 100)) {
    const result = await commands.publishVersionBatch(authority, {
      items: batch.map((item) => ({
        questionVersionId: item.versionId as string,
        expectedRowVersion: item.rowVersion as number
      }))
    })
    counts.published += result.publishedCount
    for (const item of result.items)
      if (item.result !== 'PUBLISHED')
        failures.push({
          stage: 'PUBLICATION',
          clientItemId: null,
          questionVersionId: item.questionVersionId,
          result: item.result
        })
  }
  return report()
}
