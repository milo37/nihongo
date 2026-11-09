import type { Prisma } from '../generated/prisma/client.js'
import {
  AdminRuleViolation,
  type TargetManifest
} from './adminRepositoryCommon.js'

/**
 * API port of the former `arm_admin_operation` SQL function (#504 P4).
 * It locks every manifest target in canonical id order, re-checks its expected
 * rowVersion/state and the command rules, and verifies that the Users locked by
 * `begin_admin_operation` are exactly the live Users of those targets.
 * Violations keep the SQL state and message of the SQL function so the
 * repository error mapping (and every response code) stays the same.
 */

const OPEN_CANDIDATE_STATES = [
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED'
] as const
const EDITABLE_STATES = ['DRAFT', 'CHANGES_REQUESTED'] as const
const ACTIVE_QUESTION_COMMANDS = new Set([
  'QUESTION_VERSION_CREATE',
  'QUESTION_VERSION_UPDATE',
  'REVIEW_REQUEST',
  'CHANGE_REQUEST',
  'APPROVAL',
  'APPROVAL_WITHDRAWAL',
  'PUBLICATION',
  'RETIREMENT',
  'QUESTION_ARCHIVE',
  'REVIEW_REQUEST_BATCH'
])

interface QuestionLockRow {
  readonly id: string
  readonly rowVersion: number
  readonly lifecycleStatus: string
  readonly createdByUserId: string | null
  readonly currentPublishedVersionId: string | null
}

interface VersionLockRow {
  readonly id: string
  readonly questionId: string
  readonly rowVersion: number
  readonly status: string
  readonly createdByUserId: string | null
  readonly createdByActorId: string | null
  readonly createdByRoleSnapshot: string | null
  readonly createdByLabelSnapshot: string
}

interface ReportLockRow {
  readonly id: string
  readonly questionId: string
  readonly questionVersionId: string
  readonly rowVersion: number
  readonly status: string
  readonly reporterUserId: string | null
  readonly assigneeUserId: string | null
}

export interface ArmableOperation {
  readonly operationId: string
  readonly actorUserId: string
  readonly command: string
  readonly referencedUserIds: readonly string[]
}

const violation = (sqlState: string, message: string): AdminRuleViolation =>
  new AdminRuleViolation(sqlState, message)

const between = (value: number, low: number, high: number): boolean =>
  value >= low && value <= high

const assertManifestShape = (
  command: string,
  manifest: TargetManifest
): void => {
  const q = manifest.questions.length
  const v = manifest.versions.length
  const r = manifest.reports.length
  const t = manifest.tags.length
  const distinct = (ids: readonly string[]): boolean =>
    new Set(ids).size === ids.length
  if (
    q > 100 ||
    r > 100 ||
    t > 1200 ||
    !distinct(manifest.questions.map((item) => item.id)) ||
    !distinct(manifest.versions.map((item) => item.id)) ||
    !distinct(manifest.reports.map((item) => item.id)) ||
    !distinct(manifest.tags)
  ) {
    throw violation('22023', 'Target manifest is duplicate or out of bounds.')
  }
  const invalid = (message: string): never => {
    throw violation('22023', message)
  }
  switch (command) {
    case 'QUESTION_CREATE':
      if (q !== 0 || v !== 0 || r !== 0 || !between(t, 1, 12))
        invalid('QUESTION_CREATE target manifest is invalid.')
      return
    case 'QUESTION_VERSION_CREATE':
      if (q !== 1 || v !== 0 || r !== 0 || !between(t, 1, 12))
        invalid('QUESTION_VERSION_CREATE target manifest is invalid.')
      return
    case 'QUESTION_VERSION_UPDATE':
      if (q !== 1 || v !== 1 || r !== 0)
        invalid('Single-version target manifest is invalid.')
      if (!between(t, 1, 12))
        invalid('QUESTION_VERSION_UPDATE Tag manifest is invalid.')
      return
    case 'REVIEW_REQUEST':
    case 'CHANGE_REQUEST':
    case 'APPROVAL':
    case 'APPROVAL_WITHDRAWAL':
      if (q !== 1 || v !== 1 || r !== 0 || t !== 0)
        invalid('Single-version target manifest is invalid.')
      return
    case 'RETIREMENT':
      // One current version per question; up to 100 in a batch (JLP-816).
      if (!between(q, 1, 100) || v !== q || r !== 0 || t !== 0)
        invalid('RETIREMENT target manifest is invalid.')
      return
    case 'PUBLICATION':
      if (q !== 1 || !between(v, 1, 2) || r !== 0 || t !== 0)
        invalid('PUBLICATION target manifest is invalid.')
      return
    case 'QUESTION_ARCHIVE':
      if (q !== 1 || !between(v, 0, 2) || r !== 0 || t !== 0)
        invalid('QUESTION_ARCHIVE target manifest is invalid.')
      return
    case 'REVIEW_REQUEST_BATCH':
      if (!between(q, 1, 20) || !between(v, 1, 20) || r !== 0 || t !== 0)
        invalid('REVIEW_REQUEST_BATCH target manifest is invalid.')
      return
    case 'IMPORT_APPLY':
      if (q !== 0 || v !== 0 || r !== 0 || !between(t, 1, 1200))
        invalid('IMPORT_APPLY target manifest is invalid.')
      return
    case 'EXPORT':
      if (!between(q, 1, 100) || v < q || r !== 0 || t !== 0)
        invalid('EXPORT target manifest is invalid.')
      return
    case 'REPORT_TRIAGE':
      if (q !== 1 || v !== 1 || r !== 1 || t !== 0)
        invalid('REPORT_TRIAGE target manifest is invalid.')
      return
    case 'REPORT_RESOLUTION':
      if (q !== 1 || !between(v, 1, 2) || r !== 1 || t !== 0)
        invalid('REPORT_RESOLUTION target manifest is invalid.')
      return
    default:
      throw violation('42501', 'This command cannot use the admin arm facade.')
  }
}

const byId = <T extends { readonly id: string }>(items: readonly T[]): T[] =>
  [...items].sort((left, right) => (left.id < right.id ? -1 : 1))

const sameSet = (
  left: readonly string[],
  right: readonly string[]
): boolean => {
  const a = new Set(left)
  const b = new Set(right)
  return a.size === b.size && [...a].every((value) => b.has(value))
}

export const armAdminOperation = async (
  transaction: Prisma.TransactionClient,
  operation: ArmableOperation,
  manifest: TargetManifest
): Promise<Date> => {
  const { command } = operation
  assertManifestShape(command, manifest)

  // The Tag/QVT scope mutex precedes every aggregate lock when a command can
  // assign tags; the Tag/QVT statement triggers take the same lock reentrantly.
  if (manifest.tags.length > 0) {
    await transaction.$queryRawUnsafe(
      `SELECT pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended('nihongo-tag-assignment-scope-v1', 0)
       )::text AS "locked"`
    )
  }

  const derivedUserIds: string[] = [operation.actorUserId]
  const questions: QuestionLockRow[] = []
  for (const target of byId(manifest.questions)) {
    const rows = await transaction.$queryRawUnsafe<QuestionLockRow[]>(
      `SELECT "id", "rowVersion", "lifecycleStatus"::text AS "lifecycleStatus",
              "createdByUserId", "currentPublishedVersionId"
         FROM "Question" WHERE "id" = $1::uuid FOR UPDATE`,
      target.id
    )
    const row = rows[0]
    if (
      !row ||
      row.rowVersion !== target.rowVersion ||
      row.lifecycleStatus !== target.state
    ) {
      throw violation('40001', 'Question target changed before arm.')
    }
    questions.push(row)
    if (row.createdByUserId) derivedUserIds.push(row.createdByUserId)
  }
  const questionIds = new Set(questions.map((row) => row.id))

  const versions: VersionLockRow[] = []
  for (const target of byId(manifest.versions)) {
    const rows = await transaction.$queryRawUnsafe<VersionLockRow[]>(
      `SELECT "id", "questionId", "rowVersion", "status"::text AS "status",
              "createdByUserId", "createdByActorId",
              "createdByRoleSnapshot"::text AS "createdByRoleSnapshot",
              "createdByLabelSnapshot"::text AS "createdByLabelSnapshot"
         FROM "QuestionVersion" WHERE "id" = $1::uuid FOR UPDATE`,
      target.id
    )
    const row = rows[0]
    if (
      !row ||
      row.rowVersion !== target.rowVersion ||
      row.status !== target.state ||
      !questionIds.has(row.questionId)
    ) {
      throw violation('40001', 'QuestionVersion target changed before arm.')
    }
    versions.push(row)
    if (row.createdByUserId) derivedUserIds.push(row.createdByUserId)
    if (
      (command === 'APPROVAL_WITHDRAWAL' || command === 'PUBLICATION') &&
      row.status === 'APPROVED'
    ) {
      const approver = await transaction.$queryRawUnsafe<
        Array<{ actorUserId: string | null }>
      >(
        `SELECT "actorUserId" FROM "ContentReview"
          WHERE "questionVersionId" = $1::uuid AND "action" = 'APPROVED'
          ORDER BY "occurredAt" DESC, "id" DESC LIMIT 1`,
        row.id
      )
      const approverId = approver[0]?.actorUserId
      if (approverId) derivedUserIds.push(approverId)
    }
  }
  const versionIds = new Set(versions.map((row) => row.id))

  for (const target of byId(manifest.reports)) {
    const rows = await transaction.$queryRawUnsafe<ReportLockRow[]>(
      `SELECT "id", "questionId", "questionVersionId", "rowVersion",
              "status"::text AS "status", "reporterUserId", "assigneeUserId"
         FROM "QuestionReport" WHERE "id" = $1::uuid FOR UPDATE`,
      target.id
    )
    const row = rows[0]
    if (
      !row ||
      row.rowVersion !== target.rowVersion ||
      row.status !== target.state ||
      !questionIds.has(row.questionId) ||
      !versionIds.has(row.questionVersionId)
    ) {
      throw violation('40001', 'QuestionReport target changed before arm.')
    }
    if (row.reporterUserId) derivedUserIds.push(row.reporterUserId)
    if (row.assigneeUserId) derivedUserIds.push(row.assigneeUserId)
    if (
      (command === 'REPORT_TRIAGE' && row.status !== 'OPEN') ||
      (command === 'REPORT_RESOLUTION' && row.status !== 'TRIAGED')
    ) {
      throw violation(
        '23514',
        'QuestionReport command manifest is not canonical.'
      )
    }
  }

  if (
    ACTIVE_QUESTION_COMMANDS.has(command) &&
    questions.some((row) => row.lifecycleStatus !== 'ACTIVE')
  ) {
    throw violation(
      '23514',
      'Admin content command requires an ACTIVE Question.'
    )
  }

  const versionStateRule = (
    states: readonly string[],
    message: string
  ): void => {
    if (versions.some((row) => !states.includes(row.status))) {
      throw violation('23514', message)
    }
  }
  if (command === 'QUESTION_VERSION_CREATE') {
    const open = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "QuestionVersion"
        WHERE "questionId" = ANY($1::uuid[])
          AND "status"::text = ANY($2::text[]) LIMIT 1`,
      [...questionIds],
      [...OPEN_CANDIDATE_STATES]
    )
    if (open.length > 0) {
      throw violation(
        '23514',
        'QUESTION_VERSION_CREATE requires no open candidate.'
      )
    }
  } else if (command === 'QUESTION_VERSION_UPDATE') {
    versionStateRule(
      EDITABLE_STATES,
      'QUESTION_VERSION_UPDATE target is not editable.'
    )
  } else if (command === 'REVIEW_REQUEST') {
    versionStateRule(EDITABLE_STATES, 'REVIEW_REQUEST target state is invalid.')
  } else if (command === 'CHANGE_REQUEST' || command === 'APPROVAL') {
    versionStateRule(['IN_REVIEW'], 'Review decision target state is invalid.')
  } else if (command === 'APPROVAL_WITHDRAWAL') {
    versionStateRule(
      ['APPROVED'],
      'APPROVAL_WITHDRAWAL target state is invalid.'
    )
  } else if (command === 'REVIEW_REQUEST_BATCH') {
    versionStateRule(
      EDITABLE_STATES,
      'REVIEW_REQUEST_BATCH target state is invalid.'
    )
  }

  if (command === 'PUBLICATION') {
    const question = questions[0]
    const approved = versions.filter((row) => row.status === 'APPROVED')
    const published = versions.filter((row) => row.status === 'PUBLISHED')
    const current = question?.currentPublishedVersionId ?? null
    const exact =
      approved.length === 1 &&
      published.length === versions.length - 1 &&
      (current === null
        ? versions.length === 1
        : versions.length === 2 &&
          versionIds.has(current) &&
          published.some((row) => row.id === current))
    if (!exact) {
      throw violation(
        '23514',
        'PUBLICATION manifest is not target plus exact current.'
      )
    }
  } else if (command === 'RETIREMENT') {
    const published = new Set(
      versions.filter((row) => row.status === 'PUBLISHED').map((row) => row.id)
    )
    if (
      questions.some(
        (row) =>
          row.currentPublishedVersionId === null ||
          !published.has(row.currentPublishedVersionId)
      )
    ) {
      throw violation(
        '23514',
        'RETIREMENT target is not the exact current version.'
      )
    }
  } else if (command === 'QUESTION_ARCHIVE') {
    const open = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "QuestionVersion"
        WHERE "questionId" = ANY($1::uuid[])
          AND "status"::text = ANY($2::text[])`,
      [...questionIds],
      [...OPEN_CANDIDATE_STATES]
    )
    const expected = [
      ...questions.flatMap((row) =>
        row.currentPublishedVersionId ? [row.currentPublishedVersionId] : []
      ),
      ...open.map((row) => row.id)
    ]
    if (!sameSet(expected, [...versionIds])) {
      throw violation(
        '23514',
        'QUESTION_ARCHIVE omitted or added an aggregate target.'
      )
    }
  }

  if (command === 'REVIEW_REQUEST_BATCH' || command === 'EXPORT') {
    if (
      !sameSet(
        [...questionIds],
        versions.map((row) => row.questionId)
      )
    ) {
      throw violation(
        '23514',
        'Set operation Question/version manifest is not exact.'
      )
    }
  }

  if (command === 'EXPORT' && versionIds.size > 0) {
    const reviewers = await transaction.$queryRawUnsafe<
      Array<{ userId: string }>
    >(
      `SELECT DISTINCT user_id AS "userId" FROM (
         SELECT "actorUserId" AS user_id FROM "ContentReview"
          WHERE "questionVersionId" = ANY($1::uuid[])
         UNION
         SELECT "counterpartUserId" FROM "ContentReview"
          WHERE "questionVersionId" = ANY($1::uuid[])
       ) AS live_user WHERE user_id IS NOT NULL`,
      [...versionIds]
    )
    derivedUserIds.push(...reviewers.map((row) => row.userId))
  }

  if (manifest.tags.length > 0) {
    const tags = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "Tag" WHERE "id" = ANY($1::uuid[])`,
      [...manifest.tags]
    )
    if (tags.length !== manifest.tags.length) {
      throw violation('40001', 'Tag target changed before arm.')
    }
  }

  if (!sameSet(derivedUserIds, operation.referencedUserIds)) {
    throw violation(
      '42501',
      'Referenced User set is not exact for its targets.'
    )
  }

  const clock = await transaction.$queryRawUnsafe<Array<{ occurredAt: Date }>>(
    command === 'EXPORT'
      ? `SELECT transaction_timestamp()::timestamptz(3) AS "occurredAt"`
      : `SELECT clock_timestamp()::timestamptz(3) AS "occurredAt"`
  )
  const occurredAt = clock[0]?.occurredAt
  if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime())) {
    throw new Error('Operation timestamp is unavailable.')
  }
  return occurredAt
}
