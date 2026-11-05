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
    if (!quoted && character === '(') depth += 1
    if (!quoted && character === ')') depth -= 1
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
  'phase7_issue_v1_session',
  'phase7_owned_sign_out',
  'phase7_refresh_current_remembered_session',
  'phase7_resolve_v1_principal',
  'phase7_prepare_reauthentication',
  'phase7_stage_reauthentication_session',
  'phase7_finalize_reauthentication',
  'phase7_reconcile_reauthentication',
  'phase7_abort_reauthentication',
  'phase7_cleanup_reauthentication',
  'phase7_confirm_v1_session_issuance',
  'phase7_sso_admin_session_is_fresh',
  'phase7_prepare_sso_admin_fresh',
  'phase7_create_sso_admin_fresh_transaction',
  'phase7_consume_sso_admin_fresh_transaction',
  'phase7_stage_sso_admin_fresh_proof',
  'phase7_complete_sso_admin_fresh',
  'phase7_reconcile_sso_admin_fresh',
  'phase7_cancel_sso_admin_fresh_proof',
  'phase7_erase_user',
  'phase7_complete_sso_account_erasure',
  'phase7_list_sso_account_erasures',
  'phase7_sso_account_erasure_status',
  'phase7_redact_expired_report_descriptions',
  'phase7_request_sso_account_erasure'
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

const ERASURE_WORKER_FUNCTIONS = [
  'phase7_erase_user',
  'phase7_complete_sso_account_erasure',
  'phase7_list_sso_account_erasures',
  'phase7_redact_expired_report_descriptions'
]

/**
 * The role a bridged call runs as: since PR1 nihongo_app runs the gateway and
 * erasure worker facades. Any other caller keeps its role and is refused.
 */
export const bridgedRole = <Role extends string>(
  sql: string,
  role: Role
): Role | 'nihongo_app' => {
  if (!isOwnedSessionSql(sql)) return role
  const worker = ERASURE_WORKER_FUNCTIONS.some((name) =>
    sql.includes(`"${name}"(`)
  )
  return role === (worker ? 'nihongo_erasure_worker' : 'nihongo_auth_gateway')
    ? 'nihongo_app'
    : role
}

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
  const issue = call(sql, 'phase7_issue_v1_session')
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
  const signOut = call(sql, 'phase7_owned_sign_out')
  if (signOut) {
    const token = (
      await client.query<{ token: string }>(
        `SELECT (${signOut[1]})::text AS token`,
        values
      )
    ).rows[0]?.token
    return answer([
      {
        [signOut[2] ?? 'phase7_owned_sign_out']: await signOutOwnedSession(
          owned,
          token ?? ''
        )
      }
    ])
  }
  const refresh = call(sql, 'phase7_refresh_current_remembered_session')
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
  const principal = call(sql, 'phase7_resolve_v1_principal')
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
      'phase7_prepare_reauthentication',
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
      'phase7_stage_reauthentication_session',
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
      'phase7_finalize_reauthentication',
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
      'phase7_reconcile_reauthentication',
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
      'phase7_abort_reauthentication',
      [['intentId', 'uuid']],
      async (input) => [
        await abortReauthentication(owned, input.intentId as string)
      ]
    ],
    [
      'phase7_cleanup_reauthentication',
      [['maximumRows', 'integer']],
      async (input) => [
        await cleanupReauthentication(owned, input.maximumRows as number)
      ]
    ],
    [
      'phase7_confirm_v1_session_issuance',
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
      'phase7_sso_admin_session_is_fresh',
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
      'phase7_prepare_sso_admin_fresh',
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
      'phase7_create_sso_admin_fresh_transaction',
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
      'phase7_consume_sso_admin_fresh_transaction',
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
      'phase7_stage_sso_admin_fresh_proof',
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
      'phase7_complete_sso_admin_fresh',
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
      'phase7_reconcile_sso_admin_fresh',
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
      'phase7_cancel_sso_admin_fresh_proof',
      [['proofDigest', 'text']],
      async (input) => [
        await cancelAdminFreshProof(owned, input.proofDigest as string)
      ]
    ],
    // #504 P7 PR4a: account erasure and report redaction.
    [
      'phase7_erase_user',
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
      'phase7_complete_sso_account_erasure',
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
      'phase7_list_sso_account_erasures',
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
      'phase7_sso_account_erasure_status',
      [['receiptDigest', 'text']],
      async (input) => [
        await ssoAccountErasureStatus(owned, input.receiptDigest as string)
      ]
    ],
    // #504 P7 PR4b-2: the SSO account erasure request.
    [
      'phase7_request_sso_account_erasure',
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
      'phase7_redact_expired_report_descriptions',
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
  for (const [name, names, run] of reauthentication) {
    const matched = call(sql, name)
    if (!matched) continue
    const rows = await run(
      await evaluate(client, matched[1] ?? '', names, values)
    )
    // `SELECT "fn"(…) [AS alias]` answered one column; `SELECT * FROM` rows.
    return answer(
      /^\s*SELECT\s+\*/u.test(sql) ? rows : [{ [matched[2] ?? name]: rows[0] }]
    )
  }
  throw new Error('Owned Session fixture SQL is not recognised.')
}
