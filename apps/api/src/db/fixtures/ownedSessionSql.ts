import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { PrismaClient } from '../../generated/prisma/client.js'
import {
  abortReauthentication,
  adminSessionFreshSql,
  cancelAdminFreshProof,
  cleanupReauthentication,
  completeAdminFresh,
  consumeAdminFreshTransaction,
  createAdminFreshTransaction,
  finalizeReauthentication,
  prepareAdminFresh,
  prepareReauthentication,
  reconcileAdminFresh,
  reconcileReauthentication,
  stageAdminFreshProof,
  stageReauthentication,
  type AdminFreshContextValue
} from '../../auth/adminFreshAuthority.js'
import { createQuestionReportInTransaction } from '../../admin/questionReportAuthority.js'
import {
  completeSsoAccountErasure,
  eraseUserForTest,
  listSsoAccountErasures,
  redactExpiredReportDescriptions,
  requestSsoAccountErasure,
  ssoAccountErasureStatus,
  type ErasureEnvironment
} from '../../auth/accountErasureAuthority.js'
import {
  accountCapabilities,
  beginProviderCleanup,
  claimProviderCleanups,
  completeAccountFresh,
  completeAccountLink,
  consumeAccountFreshTransaction,
  createAccountFreshTransaction,
  prepareAccountFresh,
  prepareAccountLink,
  recordProviderCleanup,
  stageAccountFreshProof,
  unlinkAccount,
  type ProviderCleanupEnvironment
} from '../../auth/ssoAccountAuthority.js'
import { changeUserAuthorityForTest } from './userAuthorityChange.js'
import {
  confirmOwnedSession,
  issueOwnedSession,
  refreshRememberedSession,
  signOutOwnedSession,
  v1PrincipalQuery,
  type OwnedSessionClient
} from '../../auth/ownedSessionAuthority.js'

/**
 * Test fixture bridge for #504 P7 PR3a. Database tests still describe a Session
 * issuance, sign-out, refresh or principal lookup with the SQL call they used
 * before the functions were dropped; this runs the API implementation instead,
 * on the same pg connection and role, and answers in the old row shape.
 */
interface PgQueryable {
  query: <Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: Row[]; rowCount: number | null }>
}

/** Failure injection points for tests that simulate a lost response. */
export interface PgOwnedSessionHooks {
  /** Called before every statement; may throw to simulate a transport loss. */
  readonly beforeQuery?: (sql: string) => void
  /** Called after a top-level COMMIT with that transaction's statements. */
  readonly afterCommit?: (statements: readonly string[]) => void
}

/** An OwnedSessionClient over a pg connection; nested calls use a savepoint. */
export const pgOwnedSessionClient = (
  client: PgQueryable,
  hooks: PgOwnedSessionHooks = {}
): OwnedSessionClient & Pick<PrismaClient, '$queryRawUnsafe'> => {
  let statements: string[] = []
  const run = async (sql: string, values: unknown[]) => {
    hooks.beforeQuery?.(sql)
    statements.push(sql)
    return client.query(sql, values)
  }
  const adapter = {
    $queryRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await run(sql, values)).rows,
    $executeRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await run(sql, values)).rowCount ?? 0,
    $transaction: async (operation: (transaction: unknown) => unknown) => {
      const savepoint = `owned_session_${randomUUID().replaceAll('-', '')}`
      let nested = true
      try {
        await client.query(`SAVEPOINT ${savepoint}`)
      } catch (error: unknown) {
        if ((error as { code?: unknown }).code !== '25P01') throw error
        nested = false
        await client.query('BEGIN')
        statements = []
      }
      try {
        const result = await operation(adapter)
        await client.query(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT')
        if (!nested) hooks.afterCommit?.(statements)
        return result
      } catch (error: unknown) {
        await client.query(
          nested ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK'
        )
        throw error
      }
    }
  }
  return adapter as unknown as OwnedSessionClient &
    Pick<PrismaClient, '$queryRawUnsafe'>
}

// Splits a SQL argument list on top-level commas.
const splitArguments = (list: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const character of list) {
    if (character === "'") quoted = !quoted
    if (!quoted && (character === '(' || character === '[')) depth += 1
    if (!quoted && (character === ')' || character === ']')) depth -= 1
    if (!quoted && depth === 0 && character === ',') {
      parts.push(current.trim())
      current = ''
    } else current += character
  }
  parts.push(current.trim())
  return parts
}

const call = (sql: string, name: string): RegExpMatchArray | null =>
  sql.match(
    new RegExp(`"${name}"\\(([\\s\\S]*)\\)(?:\\s+AS\\s+"?(\\w+)"?)?\\s*$`, 'u')
  )

// Evaluates the old SQL argument list with the caller's bind values.
const evaluate = async (
  client: PgQueryable,
  argumentList: string,
  names: ReadonlyArray<readonly [string, string]>,
  values: unknown[]
): Promise<Record<string, unknown>> => {
  const parts = splitArguments(argumentList)
  if (parts.length !== names.length)
    throw new Error('Owned Session fixture SQL has the wrong arguments.')
  return (
    await client.query<Record<string, unknown>>(
      `SELECT ${parts
        .map((part, index) => {
          const [name, type] = names[index]!
          return `(${part})::${type} AS "${name}"`
        })
        .join(', ')}`,
      values
    )
  ).rows[0]!
}

const BRIDGED_FUNCTIONS = [
  'issue_v1_session',
  'owned_sign_out',
  'refresh_current_remembered_session',
  'resolve_v1_principal',
  'prepare_reauthentication',
  'stage_reauthentication_session',
  'finalize_reauthentication',
  'reconcile_reauthentication',
  'abort_reauthentication',
  'cleanup_reauthentication',
  'confirm_v1_session_issuance',
  'sso_admin_session_is_fresh',
  'prepare_sso_admin_fresh',
  'create_sso_admin_fresh_transaction',
  'consume_sso_admin_fresh_transaction',
  'stage_sso_admin_fresh_proof',
  'complete_sso_admin_fresh',
  'reconcile_sso_admin_fresh',
  'cancel_sso_admin_fresh_proof',
  'erase_user',
  'complete_sso_account_erasure',
  'list_sso_account_erasures',
  'sso_account_erasure_status',
  'redact_expired_report_descriptions',
  'request_sso_account_erasure',
  'create_question_report',
  'prepare_sso_account_fresh',
  'prepare_sso_account_link',
  'create_sso_account_fresh_transaction',
  'consume_sso_account_fresh_transaction',
  'stage_sso_account_fresh_proof',
  'complete_sso_account_fresh',
  'complete_sso_account_link',
  'sso_account_capabilities',
  'unlink_sso_account',
  'claim_sso_provider_cleanups',
  'begin_sso_provider_cleanup',
  'record_sso_provider_cleanup',
  'change_user_authority'
] as const

/** client.query, except that calls to the dropped functions use the bridge. */
export const bridgedQuery = async <Row extends QueryResultRow = QueryResultRow>(
  client: PgQueryable,
  sql: string,
  values: unknown[] = []
): Promise<{ rows: Row[]; rowCount: number | null }> =>
  isOwnedSessionSql(sql)
    ? ownedSessionSql<Row>(client, sql, values)
    : client.query<Row>(sql, values)

/** True when the SQL calls one of the dropped functions this bridge runs. */
export const isOwnedSessionSql = (sql: string): boolean =>
  BRIDGED_FUNCTIONS.some((name) => sql.includes(`"${name}"(`))

/** #504 P8-1: nihongo_app is the only runtime role; a call keeps its role. */
export const bridgedRole = <Role extends string>(
  _sql: string,
  role: Role
): Role => role

export const ownedSessionSql = async <
  Row extends QueryResultRow = QueryResultRow
>(
  client: PgQueryable,
  sql: string,
  values: unknown[] = []
): Promise<{ rows: Row[]; rowCount: number }> => {
  const owned = pgOwnedSessionClient(client)
  const answer = (rows: unknown[]) => ({
    rows: rows as Row[],
    rowCount: rows.length
  })
  const issue = call(sql, 'issue_v1_session')
  if (issue) {
    const parts = splitArguments(issue[1] ?? '')
    if (parts.length !== 9)
      throw new Error('Session fixture issuance needs nine arguments.')
    const names = [
      ['userId', 'uuid'],
      ['authorityGeneration', 'integer'],
      ['role', 'text'],
      ['accountStatus', 'text'],
      ['sessionId', 'uuid'],
      ['token', 'text'],
      ['ipAddress', 'text'],
      ['userAgent', 'text'],
      ['remember', 'boolean']
    ] as const
    const input = (
      await client.query<Record<string, unknown>>(
        `SELECT ${parts
          .map((part, index) => {
            const [name, type] = names[index]!
            return `(${part})::${type} AS "${name}"`
          })
          .join(', ')}`,
        values
      )
    ).rows[0] as Parameters<typeof issueOwnedSession>[1]
    return answer([await issueOwnedSession(owned, input)])
  }
  const signOut = call(sql, 'owned_sign_out')
  if (signOut) {
    const token = (
      await client.query<{ token: string }>(
        `SELECT (${signOut[1]})::text AS token`,
        values
      )
    ).rows[0]?.token
    return answer([
      {
        [signOut[2] ?? 'owned_sign_out']: await signOutOwnedSession(
          owned,
          token ?? ''
        )
      }
    ])
  }
  const refresh = call(sql, 'refresh_current_remembered_session')
  if (refresh) {
    const token = (
      await client.query<{ token: string }>(
        `SELECT (${refresh[1]})::text AS token`,
        values
      )
    ).rows[0]?.token
    return answer(
      (await refreshRememberedSession(owned, token ?? '')).map(
        ({ refreshed, ...row }) => ({ ...row, refreshed })
      )
    )
  }
  const principal = call(sql, 'resolve_v1_principal')
  if (principal) {
    const token = (
      await client.query<{ token: string }>(
        `SELECT (${principal[1]})::text AS token`,
        values
      )
    ).rows[0]?.token
    return answer(
      (
        await client.query(
          `SELECT * FROM (${v1PrincipalQuery('$1')}) AS principal`,
          [token ?? '']
        )
      ).rows
    )
  }
  const reauthentication: Array<
    [
      string,
      ReadonlyArray<readonly [string, string]>,
      (input: Record<string, unknown>) => Promise<unknown[]>
    ]
  > = [
    [
      'prepare_reauthentication',
      [
        ['rawOldToken', 'text'],
        ['expectedActorId', 'uuid'],
        ['requestId', 'uuid'],
        ['environment', 'text'],
        ['intentId', 'uuid']
      ],
      async (input) => {
        const prepared = await owned.$transaction((transaction) =>
          prepareReauthentication(transaction, input as never)
        )
        return prepared
          ? [
              {
                intentId: prepared.intentId,
                operationId: prepared.operationId,
                requestId: prepared.requestId,
                email: prepared.email,
                expiresAt: prepared.expiresAt
              }
            ]
          : []
      }
    ],
    [
      'stage_reauthentication_session',
      [
        ['intentId', 'uuid'],
        ['sessionId', 'uuid'],
        ['rawNewToken', 'text'],
        ['userId', 'uuid'],
        ['expiresAt', 'timestamptz'],
        ['ipAddress', 'text'],
        ['userAgent', 'text']
      ],
      async (input) => {
        const staged = await owned.$transaction((transaction) =>
          stageReauthentication(transaction, input as never)
        )
        return staged
          ? [
              {
                ...staged,
                token: input.rawNewToken,
                ipAddress: input.ipAddress,
                userAgent: input.userAgent
              }
            ]
          : []
      }
    ],
    [
      'finalize_reauthentication',
      [
        ['intentId', 'uuid'],
        ['rawNewToken', 'text']
      ],
      async (input) => [
        await owned.$transaction((transaction) =>
          finalizeReauthentication(
            transaction,
            input.intentId as string,
            input.rawNewToken as string
          )
        )
      ]
    ],
    [
      'reconcile_reauthentication',
      [
        ['intentId', 'uuid'],
        ['rawNewToken', 'text']
      ],
      async (input) =>
        reconcileReauthentication(
          owned,
          input.intentId as string,
          input.rawNewToken as string
        )
    ],
    [
      'abort_reauthentication',
      [['intentId', 'uuid']],
      async (input) => [
        await abortReauthentication(owned, input.intentId as string)
      ]
    ],
    [
      'cleanup_reauthentication',
      [['maximumRows', 'integer']],
      async (input) => [
        await cleanupReauthentication(owned, input.maximumRows as number)
      ]
    ],
    [
      'confirm_v1_session_issuance',
      [
        ['token', 'text'],
        ['sessionId', 'uuid'],
        ['userId', 'uuid'],
        ['authorityGeneration', 'integer'],
        ['role', 'text'],
        ['accountStatus', 'text']
      ],
      async (input) => [await confirmOwnedSession(owned, input as never)]
    ],
    [
      'sso_admin_session_is_fresh',
      [['token', 'text']],
      async (input) => [
        (
          await client.query<{ fresh: boolean }>(
            `SELECT ${adminSessionFreshSql('$1')} AS fresh`,
            [input.token]
          )
        ).rows[0]?.fresh
      ]
    ],
    [
      'prepare_sso_admin_fresh',
      [
        ['token', 'text'],
        ['provider', 'text']
      ],
      async (input) => [
        await prepareAdminFresh(
          owned,
          input.token as string,
          input.provider as string
        )
      ]
    ],
    [
      'create_sso_admin_fresh_transaction',
      [
        ['provider', 'text'],
        ['stateDigest', 'text'],
        ['bindingDigest', 'text'],
        ['nonce', 'text'],
        ['codeVerifier', 'text'],
        ['callbackURL', 'text'],
        ['context', 'jsonb']
      ],
      async (input) => [
        await createAdminFreshTransaction(owned, input as never)
      ]
    ],
    [
      'consume_sso_admin_fresh_transaction',
      [
        ['provider', 'text'],
        ['stateDigest', 'text'],
        ['bindingDigest', 'text']
      ],
      async (input) =>
        consumeAdminFreshTransaction(
          owned,
          input.provider as string,
          input.stateDigest as string,
          input.bindingDigest as string
        )
    ],
    [
      'stage_sso_admin_fresh_proof',
      [
        ['context', 'jsonb'],
        ['provider', 'text'],
        ['accountId', 'text'],
        ['proofDigest', 'text'],
        ['callbackURL', 'text']
      ],
      async (input) => [
        await stageAdminFreshProof(owned, {
          context: input.context as AdminFreshContextValue,
          provider: input.provider as string,
          accountId: input.accountId as string,
          proofDigest: input.proofDigest as string,
          callbackURL: input.callbackURL as string
        })
      ]
    ],
    [
      'complete_sso_admin_fresh',
      [
        ['proofDigest', 'text'],
        ['rawOldToken', 'text'],
        ['newSessionId', 'uuid'],
        ['rawNewToken', 'text'],
        ['ipAddress', 'text'],
        ['userAgent', 'text']
      ],
      async (input) => completeAdminFresh(owned, input as never)
    ],
    [
      'reconcile_sso_admin_fresh',
      [
        ['proofDigest', 'text'],
        ['rawNewToken', 'text']
      ],
      async (input) =>
        reconcileAdminFresh(
          owned,
          input.proofDigest as string,
          input.rawNewToken as string
        )
    ],
    [
      'cancel_sso_admin_fresh_proof',
      [['proofDigest', 'text']],
      async (input) => [
        await cancelAdminFreshProof(owned, input.proofDigest as string)
      ]
    ],
    // #504 P7 PR4a: account erasure and report redaction.
    [
      'erase_user',
      [
        ['userId', 'uuid'],
        ['environment', 'text']
      ],
      async (input) => [
        await owned.$transaction((transaction) =>
          eraseUserForTest(
            transaction,
            input.userId as string,
            input.environment as ErasureEnvironment
          )
        )
      ]
    ],
    [
      'complete_sso_account_erasure',
      [
        ['requestId', 'uuid'],
        ['environment', 'text']
      ],
      async (input) => [
        await owned.$transaction((transaction) =>
          completeSsoAccountErasure(
            transaction,
            input.requestId as string,
            input.environment as ErasureEnvironment
          )
        )
      ]
    ],
    [
      'list_sso_account_erasures',
      [
        ['batchLimit', 'integer'],
        ['environment', 'text']
      ],
      async (input) => [
        await listSsoAccountErasures(
          owned as never,
          input.batchLimit as number,
          input.environment as ErasureEnvironment
        )
      ]
    ],
    [
      'sso_account_erasure_status',
      [['receiptDigest', 'text']],
      async (input) => [
        await ssoAccountErasureStatus(owned, input.receiptDigest as string)
      ]
    ],
    // #504 P7 PR4c-2: QuestionReport creation.
    [
      'create_question_report',
      [
        ['rawSessionToken', 'text'],
        ['reportId', 'uuid'],
        ['questionId', 'uuid'],
        ['questionVersionId', 'uuid'],
        ['reason', 'text'],
        ['description', 'text']
      ],
      async (input) =>
        owned.$transaction((transaction) =>
          createQuestionReportInTransaction(transaction, {
            rawSessionToken: input.rawSessionToken as string,
            reportId: input.reportId as string,
            questionId: input.questionId as string,
            questionVersionId: input.questionVersionId as string,
            reason: input.reason as string,
            description: input.description as string
          })
        )
    ],
    // #504 P7 PR4b-2: the SSO account erasure request.
    [
      'request_sso_account_erasure',
      [
        ['rawToken', 'text'],
        ['proofDigest', 'text'],
        ['receiptDigest', 'text']
      ],
      async (input) => [
        await requestSsoAccountErasure(
          owned,
          input.rawToken as string,
          (input.proofDigest as string | null) ?? null,
          (input.receiptDigest as string | null) ?? ''
        )
      ]
    ],
    [
      'redact_expired_report_descriptions',
      [
        ['batchLimit', 'integer'],
        ['environment', 'text']
      ],
      async (input) => [
        await owned.$transaction((transaction) =>
          redactExpiredReportDescriptions(
            transaction,
            input.batchLimit as number,
            input.environment as ErasureEnvironment
          )
        )
      ]
    ]
  ]
  // #504 P7 PR5a: SSO account fresh, link, unlink and provider cleanup, and
  // the TEST-only authority change.
  const text = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value)
  const json = (value: unknown): string => JSON.stringify(value)
  const cleanupEnvironment = (value: unknown) =>
    value as ProviderCleanupEnvironment
  reauthentication.push(
    [
      'prepare_sso_account_fresh',
      [
        ['rawToken', 'text'],
        ['provider', 'text']
      ],
      async (input) => [
        await prepareAccountFresh(
          owned,
          input.rawToken as string,
          text(input.provider) ?? ''
        )
      ]
    ],
    [
      'prepare_sso_account_link',
      [
        ['rawToken', 'text'],
        ['provider', 'text'],
        ['proofDigest', 'text']
      ],
      async (input) => [
        await prepareAccountLink(
          owned,
          input.rawToken as string,
          text(input.provider) ?? '',
          text(input.proofDigest)
        )
      ]
    ],
    [
      'create_sso_account_fresh_transaction',
      [
        ['provider', 'text'],
        ['stateDigest', 'text'],
        ['bindingDigest', 'text'],
        ['nonce', 'text'],
        ['codeVerifier', 'text'],
        ['callbackURL', 'text'],
        ['context', 'jsonb']
      ],
      async (input) => [
        await createAccountFreshTransaction(owned, {
          provider: text(input.provider) ?? '',
          stateDigest: input.stateDigest as string,
          bindingDigest: input.bindingDigest as string,
          nonce: input.nonce as string,
          codeVerifier: input.codeVerifier as string,
          callbackURL: text(input.callbackURL),
          context: json(input.context)
        })
      ]
    ],
    [
      'consume_sso_account_fresh_transaction',
      [
        ['provider', 'text'],
        ['stateDigest', 'text'],
        ['bindingDigest', 'text'],
        ['purpose', 'text']
      ],
      async (input) =>
        consumeAccountFreshTransaction(owned, {
          provider: text(input.provider) ?? '',
          stateDigest: input.stateDigest as string,
          bindingDigest: input.bindingDigest as string,
          purpose: text(input.purpose) ?? ''
        })
    ],
    [
      'stage_sso_account_fresh_proof',
      [
        ['context', 'jsonb'],
        ['provider', 'text'],
        ['subject', 'text'],
        ['proofDigest', 'text'],
        ['callbackURL', 'text']
      ],
      async (input) => [
        await stageAccountFreshProof(owned, {
          context: json(input.context),
          provider: text(input.provider) ?? '',
          subject: text(input.subject),
          proofDigest: input.proofDigest as string,
          callbackURL: text(input.callbackURL)
        })
      ]
    ],
    [
      'complete_sso_account_fresh',
      [
        ['proofDigest', 'text'],
        ['rawToken', 'text']
      ],
      async (input) => [
        await completeAccountFresh(
          owned,
          input.proofDigest as string,
          input.rawToken as string
        )
      ]
    ],
    [
      'complete_sso_account_link',
      [
        ['proofDigest', 'text'],
        ['rawToken', 'text']
      ],
      async (input) => [
        await completeAccountLink(
          owned,
          input.proofDigest as string,
          input.rawToken as string
        )
      ]
    ],
    [
      'sso_account_capabilities',
      [
        ['rawToken', 'text'],
        ['available', 'text[]'],
        ['proofDigest', 'text']
      ],
      async (input) => [
        await accountCapabilities(
          owned,
          input.rawToken as string,
          (input.available as string[] | null) ?? [],
          text(input.proofDigest)
        )
      ]
    ],
    [
      'unlink_sso_account',
      [
        ['rawToken', 'text'],
        ['provider', 'text'],
        ['available', 'text[]'],
        ['proofDigest', 'text']
      ],
      async (input) => [
        await unlinkAccount(
          owned,
          input.rawToken as string,
          text(input.provider),
          (input.available as string[] | null) ?? [],
          text(input.proofDigest)
        )
      ]
    ],
    [
      'claim_sso_provider_cleanups',
      [
        ['batchLimit', 'integer'],
        ['leaseSeconds', 'integer'],
        ['environment', 'text']
      ],
      async (input) => [
        await claimProviderCleanups(
          owned,
          input.batchLimit as number,
          input.leaseSeconds as number,
          cleanupEnvironment(input.environment)
        )
      ]
    ],
    [
      'begin_sso_provider_cleanup',
      [
        ['requestId', 'uuid'],
        ['provider', 'text'],
        ['leaseToken', 'uuid'],
        ['environment', 'text']
      ],
      async (input) => [
        await beginProviderCleanup(owned, {
          requestId: input.requestId as string,
          provider: text(input.provider) ?? '',
          leaseToken: text(input.leaseToken),
          environment: cleanupEnvironment(input.environment)
        })
      ]
    ],
    [
      'record_sso_provider_cleanup',
      [
        ['requestId', 'uuid'],
        ['provider', 'text'],
        ['status', 'text'],
        ['leaseToken', 'uuid'],
        ['environment', 'text']
      ],
      async (input) => [
        await recordProviderCleanup(owned, {
          requestId: input.requestId as string,
          provider: text(input.provider),
          status: text(input.status),
          leaseToken: text(input.leaseToken),
          environment: cleanupEnvironment(input.environment)
        })
      ]
    ],
    [
      'change_user_authority',
      [
        ['rawActorToken', 'text'],
        ['targetUserId', 'uuid'],
        ['expectedTargetGeneration', 'integer'],
        ['newRole', 'text'],
        ['newStatus', 'text'],
        ['environment', 'text']
      ],
      async (input) => [
        await changeUserAuthorityForTest(owned, {
          rawActorToken: input.rawActorToken as string,
          targetUserId: input.targetUserId as string,
          expectedTargetGeneration: input.expectedTargetGeneration as number,
          newRole: input.newRole as string,
          newStatus: input.newStatus as string,
          environment: input.environment as string
        })
      ]
    ]
  )
  let otherOverload = false
  for (const [name, names, run] of reauthentication) {
    const matched = call(sql, name)
    if (!matched) continue
    // Another argument count is a dropped overload: PostgreSQL answers it.
    if (splitArguments(matched[1] ?? '').length !== names.length) {
      otherOverload = true
      continue
    }
    const rows = await run(
      await evaluate(client, matched[1] ?? '', names, values)
    )
    // `SELECT "fn"(…) [AS alias]` answered one column; `SELECT * FROM` rows.
    return answer(
      /^\s*SELECT\s+\*/u.test(sql) ? rows : [{ [matched[2] ?? name]: rows[0] }]
    )
  }
  if (otherOverload) {
    const result = await client.query<Row>(sql, values)
    return { rows: result.rows, rowCount: result.rowCount ?? 0 }
  }
  throw new Error('Owned Session fixture SQL is not recognised.')
}
