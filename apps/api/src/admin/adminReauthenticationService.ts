import { randomUUID } from 'node:crypto'
import type { AdminReauthenticationResult } from '@nihongo/contracts/admin/phase7'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import type { Phase7ReauthenticationAuthApi } from '../auth/createPhase7ReauthenticationAuth.js'
import type { Phase7ReauthenticationContext } from '../auth/phase7ReauthenticationContext.js'
import { ApplicationError } from '../errors/applicationError.js'

type AuditEnvironment = 'TEST' | 'DEVELOPMENT'

interface PreparedIntentRow {
  readonly intentId: string
  readonly operationId: string
  readonly requestId: string
  readonly email: string
  readonly expiresAt: Date
}

interface FinalizedSessionRow {
  readonly id: string
  readonly familyId: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly authorityGeneration: number
}

interface ReconciledSessionRow extends FinalizedSessionRow {
  readonly state: string
}

interface AuthorityClassificationRow {
  readonly outcome: 'ACTIVE_ADMIN' | 'AUTH_SESSION_EXPIRED' | 'ADMIN_REQUIRED'
}

interface ClassifiedAbortRow {
  readonly aborted: boolean
  readonly outcome: 'ACTIVE_ADMIN' | 'AUTH_SESSION_EXPIRED' | 'ADMIN_REQUIRED'
}

interface ReauthenticationCompensationRow {
  readonly compensated: boolean
}

class InvalidReauthenticationPasswordError extends Error {
  readonly code = 'INVALID_PASSWORD'
}

export interface AdminReauthenticationInput {
  readonly actorId: string
  readonly headers: Headers
  readonly password: string
  readonly rawSessionToken: string
  readonly requestId: string
}

export interface AdminReauthenticationOutput {
  readonly response: AdminReauthenticationResult
  readonly setCookies: readonly string[]
}

export interface AdminReauthenticationService {
  reauthenticate: (
    input: AdminReauthenticationInput
  ) => Promise<AdminReauthenticationOutput>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readRawDatabaseSqlState = (error: unknown): string | undefined => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010' ||
    !isRecord(error.meta)
  ) {
    return undefined
  }

  const states: string[] = []
  if (typeof error.meta.code === 'string') states.push(error.meta.code)
  const driverAdapterError = error.meta.driverAdapterError
  if (isRecord(driverAdapterError) && isRecord(driverAdapterError.cause)) {
    const originalCode = driverAdapterError.cause.originalCode
    if (typeof originalCode === 'string') states.push(originalCode)
  }
  const [first, ...rest] = states
  return first && rest.every((state) => state === first) ? first : undefined
}

const DEFINITE_ROLLBACK_SQL_STATES = new Set([
  '22023',
  '23503',
  '23505',
  '23514',
  '40001',
  '40P01',
  '42501'
])

const isDefiniteRollback = (error: unknown): boolean => {
  const sqlState = readRawDatabaseSqlState(error)
  return (
    (sqlState !== undefined && DEFINITE_ROLLBACK_SQL_STATES.has(sqlState)) ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034')
  )
}

const unavailable = (
  disposition:
    | 'NO_TX'
    | 'DEFINITE_ROLLBACK'
    | 'COMMIT_CONFIRMED'
    | 'COMMIT_UNKNOWN',
  cause?: unknown
): ApplicationError =>
  new ApplicationError({
    code: 'SERVICE_UNAVAILABLE',
    message: '관리자 재인증 결과를 안전하게 확인할 수 없습니다.',
    retryable: false,
    retryAfterSeconds: 5,
    phase7Disposition: disposition,
    ...(cause === undefined ? {} : { cause })
  })

const expired = (
  disposition: 'NO_TX' | 'DEFINITE_ROLLBACK'
): ApplicationError =>
  new ApplicationError({
    code: 'AUTH_SESSION_EXPIRED',
    message: '로그인 세션이 만료됐습니다.',
    retryable: false,
    phase7Disposition: disposition
  })

const adminRequired = (
  disposition: 'NO_TX' | 'DEFINITE_ROLLBACK'
): ApplicationError =>
  new ApplicationError({
    code: 'ADMIN_REQUIRED',
    message: '관리자 권한이 필요합니다.',
    retryable: false,
    phase7Disposition: disposition
  })

const reauthenticationFailed = (): ApplicationError =>
  new ApplicationError({
    code: 'REAUTHENTICATION_FAILED',
    message: '비밀번호를 확인할 수 없습니다.',
    retryable: false,
    phase7Disposition: 'NO_TX'
  })

const isInvalidPasswordError = (error: unknown): boolean => {
  if (!isRecord(error)) return false
  const isInvalidCredentialCode = (value: unknown): boolean =>
    value === 'INVALID_PASSWORD' || value === 'INVALID_EMAIL_OR_PASSWORD'
  return (
    isInvalidCredentialCode(error.code) ||
    (isRecord(error.body) && isInvalidCredentialCode(error.body.code))
  )
}

const validSession = (
  row: FinalizedSessionRow | undefined,
  token: string
): row is FinalizedSessionRow =>
  row !== undefined &&
  zUuid(row.id) &&
  zUuid(row.familyId) &&
  Number.isSafeInteger(row.authorityGeneration) &&
  row.authorityGeneration > 0 &&
  row.createdAt instanceof Date &&
  Number.isFinite(row.createdAt.getTime()) &&
  row.expiresAt instanceof Date &&
  Number.isFinite(row.expiresAt.getTime()) &&
  row.expiresAt.getTime() - row.createdAt.getTime() === 24 * 60 * 60 * 1_000 &&
  token.length > 0

const zUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value
  )

const readOrderedCookies = (headers: Headers): readonly string[] => {
  const cookies = headers.getSetCookie()
  if (
    cookies.length !== 2 ||
    !cookies[0]?.includes('.session_token=') ||
    !cookies[1]?.includes('.dont_remember=') ||
    cookies.some((cookie) => /[\r\n]/u.test(cookie))
  ) {
    throw new Error('Better Auth returned an invalid cookie set.')
  }
  return cookies
}

export const createAdminReauthenticationService = ({
  auditEnvironment,
  authApi,
  client,
  context,
  createIntentId = randomUUID
}: {
  auditEnvironment: AuditEnvironment
  authApi: Phase7ReauthenticationAuthApi
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  context: Phase7ReauthenticationContext
  createIntentId?: () => string
}): AdminReauthenticationService => {
  const classify = async (
    rawSessionToken: string,
    disposition: 'NO_TX' | 'DEFINITE_ROLLBACK'
  ): Promise<never> => {
    let rows: AuthorityClassificationRow[]
    try {
      rows = await client.$queryRawUnsafe<AuthorityClassificationRow[]>(
        'SELECT * FROM "phase7_classify_reauthentication_authority"($1)',
        rawSessionToken
      )
    } catch (error: unknown) {
      throw unavailable(disposition, error)
    }
    if (rows.length !== 1) throw unavailable(disposition)
    if (rows[0]?.outcome === 'ADMIN_REQUIRED') {
      throw adminRequired(disposition)
    }
    if (rows[0]?.outcome === 'AUTH_SESSION_EXPIRED') {
      throw expired(disposition)
    }
    throw unavailable(disposition)
  }

  const abort = async (intentId: string): Promise<boolean> => {
    const rows = await client.$queryRawUnsafe<Array<{ aborted: boolean }>>(
      'SELECT "phase7_abort_reauthentication"($1) AS "aborted"',
      intentId
    )
    return rows.length === 1 && rows[0]?.aborted === true
  }

  const abortClassified = async (
    intentId: string,
    rawSessionToken: string,
    allowMissing = false
  ): Promise<ClassifiedAbortRow | null> => {
    const rows = await client.$queryRawUnsafe<ClassifiedAbortRow[]>(
      'SELECT * FROM "phase7_abort_reauthentication_classified"($1, $2)',
      intentId,
      rawSessionToken
    )
    if (allowMissing && rows.length === 0) return null
    if (rows.length !== 1 || !rows[0]) {
      throw unavailable('DEFINITE_ROLLBACK')
    }
    return rows[0]
  }

  const reconcile = async (
    intentId: string,
    token: string
  ): Promise<FinalizedSessionRow | null> => {
    const rows = await client.$queryRawUnsafe<ReconciledSessionRow[]>(
      'SELECT * FROM "phase7_reconcile_reauthentication"($1, $2)',
      intentId,
      token
    )
    if (rows.length > 1) return null
    const row = rows[0]
    return row?.state === 'FINALIZED' && validSession(row, token) ? row : null
  }

  const compensate = async (
    intentId: string,
    token: string,
    disposition: 'COMMIT_CONFIRMED' | 'COMMIT_UNKNOWN',
    cause: unknown
  ): Promise<never> => {
    try {
      const rows = await client.$queryRawUnsafe<
        ReauthenticationCompensationRow[]
      >(
        'SELECT "phase7_compensate_reauthentication"($1, $2) AS "compensated"',
        intentId,
        token
      )
      if (rows.length !== 1 || rows[0]?.compensated !== true) {
        throw new Error('Reauthentication compensation was not confirmed.')
      }
    } catch (compensationError: unknown) {
      throw unavailable(disposition, compensationError)
    }
    throw unavailable(disposition, cause)
  }

  const resolveDefiniteRollback = async ({
    cause,
    intentId,
    oldToken,
    token
  }: {
    cause: unknown
    intentId: string
    oldToken: string
    token: string
  }): Promise<FinalizedSessionRow> => {
    let resolution: ClassifiedAbortRow | null
    try {
      resolution = await abortClassified(intentId, oldToken)
    } catch (classificationError: unknown) {
      throw unavailable('DEFINITE_ROLLBACK', classificationError)
    }
    if (!resolution || !resolution.aborted) {
      let reconciled: FinalizedSessionRow | null
      try {
        reconciled = await reconcile(intentId, token)
      } catch (reconciliationError: unknown) {
        return await compensate(
          intentId,
          token,
          'COMMIT_UNKNOWN',
          reconciliationError
        )
      }
      if (!reconciled) {
        return await compensate(intentId, token, 'COMMIT_UNKNOWN', cause)
      }
      return reconciled
    }
    if (resolution.outcome === 'ADMIN_REQUIRED') {
      throw adminRequired('DEFINITE_ROLLBACK')
    }
    if (resolution.outcome === 'AUTH_SESSION_EXPIRED') {
      throw expired('DEFINITE_ROLLBACK')
    }
    throw unavailable('DEFINITE_ROLLBACK', cause)
  }

  return {
    reauthenticate: async (input) => {
      const preparedIntentId = createIntentId()
      if (!zUuid(preparedIntentId)) throw unavailable('NO_TX')
      let preparedRows: PreparedIntentRow[]
      try {
        preparedRows = await client.$queryRawUnsafe<PreparedIntentRow[]>(
          `SELECT * FROM "phase7_prepare_reauthentication"(
            $1, $2, $3, $4, $5
          )`,
          input.rawSessionToken,
          input.actorId,
          input.requestId,
          auditEnvironment,
          preparedIntentId
        )
      } catch (error: unknown) {
        if (isDefiniteRollback(error)) throw unavailable('NO_TX', error)
        let resolution: ClassifiedAbortRow | null
        try {
          resolution = await abortClassified(
            preparedIntentId,
            input.rawSessionToken,
            true
          )
        } catch (recoveryError: unknown) {
          throw unavailable('COMMIT_UNKNOWN', recoveryError)
        }
        if (!resolution) throw unavailable('NO_TX', error)
        if (!resolution.aborted) throw unavailable('COMMIT_UNKNOWN', error)
        if (resolution.outcome === 'ADMIN_REQUIRED') {
          throw adminRequired('DEFINITE_ROLLBACK')
        }
        if (resolution.outcome === 'AUTH_SESSION_EXPIRED') {
          throw expired('DEFINITE_ROLLBACK')
        }
        throw unavailable('DEFINITE_ROLLBACK', error)
      }
      if (preparedRows.length !== 1) {
        return await classify(input.rawSessionToken, 'NO_TX')
      }
      const prepared = preparedRows[0]!
      if (
        prepared.intentId !== preparedIntentId ||
        !zUuid(prepared.operationId) ||
        prepared.requestId !== input.requestId ||
        prepared.email.length === 0 ||
        !(prepared.expiresAt instanceof Date) ||
        !Number.isFinite(prepared.expiresAt.getTime())
      ) {
        let aborted: boolean
        try {
          aborted = await abort(preparedIntentId)
        } catch (error: unknown) {
          throw unavailable('NO_TX', error)
        }
        if (!aborted) throw unavailable('COMMIT_UNKNOWN')
        throw unavailable('NO_TX')
      }

      let token = ''
      let cookies: readonly string[] = []
      try {
        await context.run(prepared.intentId, async () => {
          const verification = await authApi.verifyPassword({
            headers: input.headers,
            body: { password: input.password }
          })
          if (verification.status !== true) {
            throw new InvalidReauthenticationPasswordError()
          }
          const signIn = await authApi.signInEmail({
            headers: input.headers,
            body: {
              email: prepared.email,
              password: input.password,
              rememberMe: false
            },
            returnHeaders: true
          })
          token = signIn.response.token
          cookies = readOrderedCookies(signIn.headers)
        })
      } catch (error: unknown) {
        let resolution: ClassifiedAbortRow | null
        try {
          resolution = await abortClassified(
            prepared.intentId,
            input.rawSessionToken
          )
        } catch (classificationError: unknown) {
          throw unavailable('DEFINITE_ROLLBACK', classificationError)
        }
        if (!resolution || !resolution.aborted) {
          throw unavailable('COMMIT_UNKNOWN', error)
        }
        if (resolution.outcome === 'ADMIN_REQUIRED') {
          throw adminRequired('DEFINITE_ROLLBACK')
        }
        if (resolution.outcome === 'AUTH_SESSION_EXPIRED') {
          throw expired('DEFINITE_ROLLBACK')
        }
        if (isInvalidPasswordError(error)) {
          throw reauthenticationFailed()
        }
        throw unavailable('DEFINITE_ROLLBACK', error)
      }
      if (token.length === 0 || cookies.length !== 2) {
        let aborted: boolean
        try {
          aborted = await abort(prepared.intentId)
        } catch (error: unknown) {
          throw unavailable('DEFINITE_ROLLBACK', error)
        }
        if (!aborted) throw unavailable('COMMIT_UNKNOWN')
        throw unavailable('DEFINITE_ROLLBACK')
      }

      let rows: FinalizedSessionRow[]
      try {
        rows = await client.$queryRawUnsafe<FinalizedSessionRow[]>(
          'SELECT * FROM "phase7_finalize_reauthentication"($1, $2)',
          prepared.intentId,
          token
        )
      } catch (error: unknown) {
        if (isDefiniteRollback(error)) {
          rows = [
            await resolveDefiniteRollback({
              cause: error,
              intentId: prepared.intentId,
              oldToken: input.rawSessionToken,
              token
            })
          ]
        } else {
          let reconciled: FinalizedSessionRow | null
          try {
            reconciled = await reconcile(prepared.intentId, token)
          } catch (reconciliationError: unknown) {
            return await compensate(
              prepared.intentId,
              token,
              'COMMIT_UNKNOWN',
              reconciliationError
            )
          }
          if (reconciled) {
            rows = [reconciled]
          } else {
            try {
              rows = await client.$queryRawUnsafe<FinalizedSessionRow[]>(
                'SELECT * FROM "phase7_finalize_reauthentication"($1, $2)',
                prepared.intentId,
                token
              )
            } catch (retryError: unknown) {
              if (isDefiniteRollback(retryError)) {
                rows = [
                  await resolveDefiniteRollback({
                    cause: retryError,
                    intentId: prepared.intentId,
                    oldToken: input.rawSessionToken,
                    token
                  })
                ]
              } else {
                let afterRetry: FinalizedSessionRow | null
                try {
                  afterRetry = await reconcile(prepared.intentId, token)
                } catch (reconciliationError: unknown) {
                  return await compensate(
                    prepared.intentId,
                    token,
                    'COMMIT_UNKNOWN',
                    reconciliationError
                  )
                }
                if (afterRetry) {
                  rows = [afterRetry]
                } else {
                  let aborted: boolean
                  try {
                    aborted = await abort(prepared.intentId)
                  } catch (abortError: unknown) {
                    return await compensate(
                      prepared.intentId,
                      token,
                      'COMMIT_UNKNOWN',
                      abortError
                    )
                  }
                  if (aborted) {
                    throw unavailable('COMMIT_UNKNOWN', retryError)
                  }
                  let finalReconciliation: FinalizedSessionRow | null
                  try {
                    finalReconciliation = await reconcile(
                      prepared.intentId,
                      token
                    )
                  } catch (reconciliationError: unknown) {
                    return await compensate(
                      prepared.intentId,
                      token,
                      'COMMIT_UNKNOWN',
                      reconciliationError
                    )
                  }
                  if (!finalReconciliation) {
                    return await compensate(
                      prepared.intentId,
                      token,
                      'COMMIT_UNKNOWN',
                      retryError
                    )
                  }
                  rows = [finalReconciliation]
                }
              }
            }
          }
        }
      }

      let row = rows.length === 1 ? rows[0] : undefined
      if (!validSession(row, token)) {
        try {
          let reconciled = await reconcile(prepared.intentId, token)
          if (!reconciled) {
            const aborted = await abort(prepared.intentId)
            if (!aborted) {
              reconciled = await reconcile(prepared.intentId, token)
            }
          }
          if (!reconciled) throw unavailable('COMMIT_CONFIRMED')
          row = reconciled
        } catch (error: unknown) {
          return await compensate(
            prepared.intentId,
            token,
            'COMMIT_CONFIRMED',
            error
          )
        }
      }

      return {
        response: {
          reauthenticatedAt: row.createdAt.toISOString(),
          assuranceExpiresAt: new Date(
            row.createdAt.getTime() + 5 * 60_000
          ).toISOString()
        },
        setCookies: cookies
      }
    }
  }
}
