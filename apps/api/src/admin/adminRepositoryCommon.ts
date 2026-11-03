import { Prisma } from '../generated/prisma/client.js'

/** Helpers and row shapes shared by the Phase 7 admin repositories (#497). */

export type AuditEnvironment = 'TEST' | 'DEVELOPMENT'

export interface TargetManifestItem {
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

export interface OccurredAtRow {
  readonly occurredAt: Date
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
  'Phase 7 operation requires an existing Session.',
  'Phase 7 operation Session family is unavailable.',
  'Phase 7 operation Session is unavailable.',
  'Phase 7 operation authority is stale or insufficient.',
  'Phase 7 authority expired before commit.',
  'A referenced Phase 7 User is unavailable.',
  'Phase 7 referenced User set is not exact for its targets.'
])

export const toIso = (value: Date): string => value.toISOString()

export const uniqueSorted = (values: readonly (string | null)[]): string[] =>
  [...new Set(values.filter((value): value is string => value !== null))].sort()

export const rawDatabaseIdentity = (
  error: unknown
): { readonly sqlState: string; readonly message: string } | undefined => {
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
  await transaction.$executeRawUnsafe(
    `SELECT "phase7_finish_admin_operation"($1)`,
    operationId
  )
}
