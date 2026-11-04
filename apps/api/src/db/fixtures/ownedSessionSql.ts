import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import {
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

/** An OwnedSessionClient over a pg connection; nested calls use a savepoint. */
export const pgOwnedSessionClient = (
  client: PgQueryable
): OwnedSessionClient => {
  const adapter = {
    $queryRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await client.query(sql, values)).rows,
    $executeRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await client.query(sql, values)).rowCount ?? 0,
    $transaction: async (operation: (transaction: unknown) => unknown) => {
      const savepoint = `owned_session_${randomUUID().replaceAll('-', '')}`
      let nested = true
      try {
        await client.query(`SAVEPOINT ${savepoint}`)
      } catch (error: unknown) {
        if ((error as { code?: unknown }).code !== '25P01') throw error
        nested = false
        await client.query('BEGIN')
      }
      try {
        const result = await operation(adapter)
        await client.query(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT')
        return result
      } catch (error: unknown) {
        await client.query(
          nested ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK'
        )
        throw error
      }
    }
  }
  return adapter as unknown as OwnedSessionClient
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
  throw new Error('Owned Session fixture SQL is not recognised.')
}
