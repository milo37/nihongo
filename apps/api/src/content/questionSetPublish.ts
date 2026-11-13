import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  validateQuestionImportRequestSchema,
  type AdminImportItem
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

/** The fixed 500 question set, in import order (JLP-816, JLP-828). */
export const QUESTION_SET_FILE_NAMES = [
  'n5.v1.json',
  'n4.v1.json',
  'n3.v1.json',
  'n2.v1.json',
  'n1.v1.json',
  'n5.add.v1.json',
  'n4.add.v1.json',
  'n3.add.v1.json',
  'n2.add.v1.json',
  'n1.add.v1.json'
] as const

export interface QuestionSetFile {
  readonly name: string
  readonly sha256: string
  readonly items: readonly AdminImportItem[]
}

export class QuestionSetInputError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

/** Reads exactly the 10 set files; a missing or extra file refuses the run. */
export const readQuestionSet = async (
  directory: string
): Promise<QuestionSetFile[]> => {
  const present = (await readdir(directory)).toSorted()
  const expected = [...QUESTION_SET_FILE_NAMES].toSorted()
  if (JSON.stringify(present) !== JSON.stringify(expected)) {
    throw new QuestionSetInputError('QUESTION_SET_FILES_INVALID')
  }
  const files: QuestionSetFile[] = []
  for (const name of QUESTION_SET_FILE_NAMES) {
    const bytes = await readFile(join(directory, name))
    const parsed = validateQuestionImportRequestSchema.safeParse(
      JSON.parse(bytes.toString('utf8'))
    )
    if (!parsed.success) {
      throw new QuestionSetInputError('QUESTION_SET_FILE_INVALID')
    }
    files.push({
      name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      items: parsed.data.items
    })
  }
  return files
}

type Stage = 'IMPORT' | 'REVIEW_REQUEST' | 'APPROVAL' | 'PUBLICATION'

interface VersionStateRow {
  readonly fingerprint: string
  readonly versionId: string
  readonly status: string
  readonly rowVersion: number
  readonly lifecycleStatus: string
  readonly currentPublishedVersionId: string | null
}

interface PlannedItem {
  readonly file: string
  readonly clientItemId: string
  readonly fingerprint: string
  readonly stage: Stage | 'PUBLISHED'
  readonly versionId: string | null
  readonly rowVersion: number | null
}

export interface QuestionSetConflict {
  readonly file: string
  readonly clientItemId: string
  readonly reason: string
}

export interface QuestionSetIssue {
  readonly file: string
  readonly itemIndex: number
  readonly code: string
}

export interface QuestionSetFailure {
  readonly stage: Stage
  readonly questionVersionId: string
  readonly result: string
}

export interface QuestionSetReport {
  readonly runId: string
  readonly execute: boolean
  readonly files: ReadonlyArray<{ name: string; sha256: string; items: number }>
  readonly items: number
  readonly pending: Readonly<Record<Stage, number>>
  readonly imported: number
  readonly reviewRequested: number
  readonly approved: number
  readonly published: number
  readonly skippedPublished: number
  readonly conflicts: readonly QuestionSetConflict[]
  readonly issues: readonly QuestionSetIssue[]
  readonly failures: readonly QuestionSetFailure[]
}

const STATE_SQL = `SELECT version."contentFingerprint" AS "fingerprint",
    version."id" AS "versionId",
    version."status"::text AS "status",
    version."rowVersion",
    question."lifecycleStatus"::text AS "lifecycleStatus",
    question."currentPublishedVersionId"
  FROM "QuestionVersion" AS version
  JOIN "Question" AS question ON question."id" = version."questionId"
  WHERE version."contentFingerprint" = ANY($1::varchar[])
  ORDER BY version."id"`

export const ACTOR_SQL = `SELECT "id" FROM "User"
  WHERE "role" = 'ADMIN' AND "accountStatus" = 'ACTIVE'
  ORDER BY "id"`

export const OPEN_STAGE: Readonly<Record<string, Exclude<Stage, 'IMPORT'>>> = {
  DRAFT: 'REVIEW_REQUEST',
  IN_REVIEW: 'APPROVAL',
  APPROVED: 'PUBLICATION'
}

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size))
  return chunks
}

/**
 * Plans every item from its content fingerprint: no version yet is IMPORT, a
 * DRAFT/IN_REVIEW/APPROVED version continues from its next step and the
 * question's current published version is skipped. Anything else (changes
 * requested, retired, archived, another published version) is a conflict a
 * person must decide.
 */
const planItems = async (
  client: PrismaClient,
  files: readonly QuestionSetFile[]
): Promise<{ items: PlannedItem[]; conflicts: QuestionSetConflict[] }> => {
  const entries = files.flatMap((file) =>
    file.items.map((item) => ({
      file: file.name,
      clientItemId: item.clientItemId,
      fingerprint: contentFingerprint(item.content)
    }))
  )
  const rows = await client.$queryRawUnsafe<VersionStateRow[]>(
    STATE_SQL,
    entries.map(({ fingerprint }) => fingerprint)
  )
  const byFingerprint = new Map<string, VersionStateRow[]>()
  for (const row of rows)
    byFingerprint.set(row.fingerprint, [
      ...(byFingerprint.get(row.fingerprint) ?? []),
      row
    ])
  const items: PlannedItem[] = []
  const conflicts: QuestionSetConflict[] = []
  for (const entry of entries) {
    const versions = byFingerprint.get(entry.fingerprint) ?? []
    if (versions.length === 0) {
      items.push({
        ...entry,
        stage: 'IMPORT',
        versionId: null,
        rowVersion: null
      })
      continue
    }
    const published = versions.find(
      (version) => version.currentPublishedVersionId === version.versionId
    )
    const open = versions.filter(
      (version) => OPEN_STAGE[version.status] !== undefined
    )
    if (published) {
      items.push({
        ...entry,
        stage: 'PUBLISHED',
        versionId: published.versionId,
        rowVersion: published.rowVersion
      })
      continue
    }
    const candidate = open.length === 1 ? open[0] : undefined
    const stage = candidate ? OPEN_STAGE[candidate.status] : undefined
    if (
      !candidate ||
      !stage ||
      versions.length !== 1 ||
      candidate.lifecycleStatus !== 'ACTIVE' ||
      candidate.currentPublishedVersionId !== null
    ) {
      conflicts.push({
        file: entry.file,
        clientItemId: entry.clientItemId,
        reason: versions
          .map((version) => `${version.status}/${version.lifecycleStatus}`)
          .join(',')
      })
      continue
    }
    items.push({
      ...entry,
      stage,
      versionId: candidate.versionId,
      rowVersion: candidate.rowVersion
    })
  }
  return { items, conflicts }
}

const countStage = (
  items: readonly PlannedItem[],
  stage: PlannedItem['stage']
): number => items.filter((item) => item.stage === stage).length

/**
 * Imports, requests review for, approves and publishes the question set as
 * the one ACTIVE ADMIN, through the same admin command services as the admin
 * screen (JLP-828). Without `execute` it only plans. Every audit row of one
 * run carries `runId` as its request id. A rerun continues where an earlier
 * run stopped and skips what is already published.
 */
export const publishQuestionSet = async ({
  auditEnvironment,
  client,
  execute,
  files,
  runId = randomUUID()
}: {
  readonly auditEnvironment: 'TEST' | 'DEVELOPMENT' | 'PRODUCTION'
  readonly client: PrismaClient
  readonly execute: boolean
  readonly files: readonly QuestionSetFile[]
  readonly runId?: string
}): Promise<QuestionSetReport> => {
  const admins = await client.$queryRawUnsafe<Array<{ id: string }>>(ACTOR_SQL)
  const actor = admins.length === 1 ? admins[0] : undefined
  if (!actor) throw new QuestionSetInputError('QUESTION_SET_ACTOR_INVALID')

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

  const initial = await planItems(client, files)
  const issues: QuestionSetIssue[] = []
  const toImport = files
    .map((file) => ({
      file,
      items: file.items.filter((item) =>
        initial.items.some(
          (planned) =>
            planned.file === file.name &&
            planned.clientItemId === item.clientItemId &&
            planned.stage === 'IMPORT'
        )
      )
    }))
    .filter(({ items }) => items.length > 0)
  const validations = []
  for (const { file, items } of toImport) {
    const validation = await commands.validateImport({ items })
    for (const issue of validation.errors)
      issues.push({
        file: file.name,
        itemIndex: file.items.indexOf(
          items[issue.itemIndex] as AdminImportItem
        ),
        code: issue.code
      })
    validations.push({ items, validationDigest: validation.validationDigest })
  }

  const pending: Record<Stage, number> = {
    IMPORT: countStage(initial.items, 'IMPORT'),
    REVIEW_REQUEST: countStage(initial.items, 'REVIEW_REQUEST'),
    APPROVAL: countStage(initial.items, 'APPROVAL'),
    PUBLICATION: countStage(initial.items, 'PUBLICATION')
  }
  const skippedPublished = initial.items.filter(
    (item) => item.stage === 'PUBLISHED'
  ).length
  const failures: QuestionSetFailure[] = []
  const counts = { imported: 0, reviewRequested: 0, approved: 0, published: 0 }
  const report = (): QuestionSetReport => ({
    runId,
    execute,
    files: files.map(({ name, sha256, items }) => ({
      name,
      sha256,
      items: items.length
    })),
    items: files.reduce((total, file) => total + file.items.length, 0),
    pending,
    ...counts,
    skippedPublished,
    conflicts: initial.conflicts,
    issues,
    failures
  })
  if (!execute || initial.conflicts.length > 0 || issues.length > 0) {
    return report()
  }

  const authority = createOperatorAdminAuthority({
    actorId: actor.id,
    requestId: runId
  })
  // One import transaction per file, like the admin import screen.
  for (const { items, validationDigest } of validations) {
    const applied = await commands.applyImport(authority, {
      importId: randomUUID(),
      validationDigest,
      items: [...items]
    })
    counts.imported += applied.response.createdCount
  }

  const reviewable = (await planItems(client, files)).items.filter(
    (item) => item.stage === 'REVIEW_REQUEST'
  )
  for (const batch of chunk(reviewable, 20)) {
    const result = await commands.requestReviewBatch(authority, {
      items: batch.map((item) => ({
        versionId: item.versionId as string,
        expectedRowVersion: item.rowVersion as number
      }))
    })
    counts.reviewRequested += result.items.length
  }

  const approvable = (await planItems(client, files)).items.filter(
    (item) => item.stage === 'APPROVAL'
  )
  for (const batch of chunk(approvable, 100)) {
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
          questionVersionId: item.questionVersionId,
          result: item.result
        })
  }

  const publishable = (await planItems(client, files)).items.filter(
    (item) => item.stage === 'PUBLICATION'
  )
  for (const batch of chunk(publishable, 100)) {
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
          questionVersionId: item.questionVersionId,
          result: item.result
        })
  }
  return report()
}
