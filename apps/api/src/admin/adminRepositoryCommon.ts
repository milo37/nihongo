import { createHash } from 'node:crypto'
import { finishAdminOperation } from './adminOperationAuthority.js'
import {
  createAdminAuditContentDigestPreimage,
  type AdminAuditLogItem
} from '@nihongo/contracts/admin/content-operations'
import { Prisma } from '../generated/prisma/client.js'

/** Helpers and row shapes shared by the admin repositories (#497). */

export type AuditEnvironment = 'TEST' | 'DEVELOPMENT'

interface TargetManifestItem {
  readonly id: string
  readonly rowVersion: number
  readonly state: string
}

export interface TargetManifest {
  readonly questions: readonly TargetManifestItem[]
  readonly versions: readonly TargetManifestItem[]
  readonly reports: readonly TargetManifestItem[]
  readonly tags: readonly string[]
}

export interface OperationContext {
  readonly actorUserId: string
  readonly operationId: string
  readonly occurredAt: Date
}

export interface BegunOperationRow {
  readonly actorUserId: string
  readonly operationId: string
}

export interface AuthorityProbeRow {
  readonly isFresh: boolean | null
  readonly principalRole: 'USER' | 'ADMIN' | null
  readonly principalUserId: string | null
}

export interface AdminAuthorityClassificationRow {
  readonly outcome: 'ADMIN_REQUIRED' | 'AUTH_SESSION_EXPIRED'
}

export const CREATE_CHANGED_FIELDS = [
  'LIFECYCLE_STATUS',
  'LEVEL',
  'SUBJECT',
  'QUESTION_TYPE',
  'DIFFICULTY',
  'PASSAGE',
  'QUESTION_TEXT',
  'EXPLANATION_KO',
  'EXPLANATION_JA',
  'OPTIONS',
  'CORRECT_OPTION',
  'TAGS'
] as const

export const AUTHORITY_FAILURE_MESSAGES = new Set([
  'Operation requires an existing Session.',
  'Operation Session family is unavailable.',
  'Operation Session is unavailable.',
  'Operation authority is stale or insufficient.',
  'Authority expired before commit.',
  'A referenced User is unavailable.',
  'Referenced User set is not exact for its targets.'
])

export const toIso = (value: Date): string => value.toISOString()

/**
 * A content rule checked in the API (#504 P4). It carries the SQL state and
 * message of the database rule it replaced, so error mapping stays the same.
 */
export class AdminRuleViolation extends Error {
  readonly sqlState: string

  constructor(sqlState: string, message: string) {
    super(message)
    this.name = 'AdminRuleViolation'
    this.sqlState = sqlState
  }
}

export type AdminAuditDigestFields = Pick<
  AdminAuditLogItem,
  | 'operationId'
  | 'command'
  | 'targetType'
  | 'targetId'
  | 'beforeState'
  | 'afterState'
  | 'beforeRowVersion'
  | 'afterRowVersion'
  | 'changedFields'
  | 'metadata'
>

/** sha256 of the shared canonical audit preimage, as the read API verifies. */
export const adminAuditContentDigest = (
  fields: AdminAuditDigestFields
): string =>
  createHash('sha256')
    .update(
      createAdminAuditContentDigestPreimage(fields as AdminAuditLogItem),
      'utf8'
    )
    .digest('hex')

/**
 * QuestionVersion content updates are made by the locked live author only
 * (former finish-time check). The actor itself was locked and checked as an
 * active ADMIN by begin_admin_operation.
 */
export const assertVersionAuthor = async (
  transaction: Prisma.TransactionClient,
  versionId: string,
  actorUserId: string
): Promise<void> => {
  const rows = await transaction.$queryRawUnsafe<Array<{ author: boolean }>>(
    `SELECT "createdByUserId" = $2::uuid AND "createdByActorId" = $2::uuid
            AND "createdByRoleSnapshot" = 'ADMIN'
            AND "createdByLabelSnapshot" = 'ACTIVE_ADMIN' AS "author"
       FROM "QuestionVersion" WHERE "id" = $1::uuid FOR SHARE`,
    versionId,
    actorUserId
  )
  if (rows[0]?.author !== true) {
    throw new AdminRuleViolation(
      '42501',
      'QuestionVersion content updates require the locked live author.'
    )
  }
}

/**
 * A REQUESTED review is written by the version author (former evidence
 * trigger rule).
 */
export const assertReviewRequestAuthor = async (
  transaction: Prisma.TransactionClient,
  versionId: string,
  actorUserId: string
): Promise<void> => {
  const rows = await transaction.$queryRawUnsafe<Array<{ author: boolean }>>(
    `SELECT "createdByUserId" IS NOT DISTINCT FROM $2::uuid
            AND "createdByActorId" IS NOT DISTINCT FROM $2::uuid AS "author"
       FROM "QuestionVersion" WHERE "id" = $1::uuid`,
    versionId,
    actorUserId
  )
  if (rows[0]?.author !== true) {
    throw new AdminRuleViolation(
      '23514',
      'Review request must be authored by the version author.'
    )
  }
}

/**
 * Options and tags of a version change only while it is editable and no study
 * session pins it (former QuestionVersion children trigger).
 */
export const assertEditableUnpinnedVersion = async (
  transaction: Prisma.TransactionClient,
  versionId: string
): Promise<void> => {
  const rows = await transaction.$queryRawUnsafe<Array<{ editable: boolean }>>(
    `SELECT version."status"::text IN ('DRAFT', 'CHANGES_REQUESTED')
            AND NOT EXISTS (
              SELECT 1 FROM "StudySessionQuestion" AS pinned
               WHERE pinned."questionVersionId" = version."id"
            ) AS "editable"
       FROM "QuestionVersion" AS version
      WHERE version."id" = $1::uuid`,
    versionId
  )
  if (rows[0]?.editable !== true) {
    throw new AdminRuleViolation(
      '23514',
      'QuestionVersion children require an editable unpinned parent.'
    )
  }
}

export const uniqueSorted = (values: readonly (string | null)[]): string[] =>
  [...new Set(values.filter((value): value is string => value !== null))].sort()

export const rawDatabaseIdentity = (
  error: unknown
): { readonly sqlState: string; readonly message: string } | undefined => {
  if (error instanceof AdminRuleViolation) {
    return { sqlState: error.sqlState, message: error.message }
  }
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010' ||
    typeof error.meta !== 'object' ||
    error.meta === null
  ) {
    return undefined
  }
  const meta = error.meta as Record<string, unknown>
  const identities: Array<{ sqlState: string; message: string }> = []
  if (typeof meta.code === 'string' && typeof meta.message === 'string') {
    identities.push({ sqlState: meta.code, message: meta.message })
  }
  const driver = meta.driverAdapterError
  if (typeof driver === 'object' && driver !== null) {
    const cause = (driver as Record<string, unknown>).cause
    if (typeof cause === 'object' && cause !== null) {
      const record = cause as Record<string, unknown>
      if (
        typeof record.originalCode === 'string' &&
        typeof record.originalMessage === 'string'
      ) {
        identities.push({
          sqlState: record.originalCode,
          message: record.originalMessage
        })
      }
    }
  }
  const [first, ...rest] = identities
  if (
    !first ||
    rest.some(
      (identity) =>
        identity.sqlState !== first.sqlState ||
        identity.message !== first.message
    )
  ) {
    return undefined
  }
  return {
    sqlState: first.sqlState,
    message:
      first.message
        .split('\n', 1)[0]
        ?.replace(/^ERROR:\s*/u, '')
        .trim() ?? ''
  }
}

export const finishOperation = async (
  transaction: Prisma.TransactionClient,
  operationId: string
): Promise<void> => {
  await finishAdminOperation(transaction, operationId)
}
