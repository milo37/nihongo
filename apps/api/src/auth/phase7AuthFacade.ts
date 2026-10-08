import { randomBytes, randomUUID } from 'node:crypto'
import { createEmailVerificationToken } from 'better-auth/api'
import { hashPassword, verifyJWT, verifyPassword } from 'better-auth/crypto'
import { z } from 'zod'
import type { ApiEnvironment } from '../config/env.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { INTERNAL_CLIENT_IP_HEADER } from './clientIp.js'
import type { AuthEmailDispatcher } from './emailDispatcher.js'
import {
  createExpiredPhase7SessionCookies,
  createPhase7SessionCookie,
  readPhase7SessionToken
} from './phase7SessionCookie.js'

const ONE_HOUR_SECONDS = 60 * 60
const MAX_TOKEN_LENGTH = 4_096
const STALE_ISSUER_SQLSTATE = '42501'
const STALE_ISSUER_DATABASE_MESSAGE = 'V1 Session issuance proof is stale.'

interface RawDatabaseErrorIdentity {
  databaseMessage: string
  sqlState: string
}

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readRawDatabaseErrorIdentity = (
  error: unknown
): RawDatabaseErrorIdentity | undefined => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010' ||
    !isUnknownRecord(error.meta)
  ) {
    return undefined
  }

  const identities: RawDatabaseErrorIdentity[] = []
  if (
    typeof error.meta.code === 'string' &&
    typeof error.meta.message === 'string'
  ) {
    identities.push({
      databaseMessage: error.meta.message,
      sqlState: error.meta.code
    })
  }

  const driverAdapterError = error.meta.driverAdapterError
  if (isUnknownRecord(driverAdapterError)) {
    const cause = driverAdapterError.cause
    if (
      isUnknownRecord(cause) &&
      typeof cause.originalCode === 'string' &&
      typeof cause.originalMessage === 'string'
    ) {
      identities.push({
        databaseMessage: cause.originalMessage,
        sqlState: cause.originalCode
      })
    }
  }

  const [identity, ...rest] = identities
  if (
    !identity ||
    rest.some(
      (candidate) =>
        candidate.sqlState !== identity.sqlState ||
        candidate.databaseMessage !== identity.databaseMessage
    )
  ) {
    return undefined
  }
  return identity
}

const isStaleIssuerRace = (error: unknown): boolean => {
  const identity = readRawDatabaseErrorIdentity(error)
  if (!identity || identity.sqlState !== STALE_ISSUER_SQLSTATE) return false

  const databaseMessage = identity.databaseMessage
    .split('\n', 1)[0]
    ?.replace(/^ERROR:\s*/u, '')
    .trim()
  return databaseMessage === STALE_ISSUER_DATABASE_MESSAGE
}

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine((value) => !hasUnpairedSurrogate(value))
const emailSchema = z
  .email()
  .max(320)
  .transform((value) => value.toLowerCase())
const signInSchema = z
  .object({ email: emailSchema, password: passwordSchema })
  .strict()
const signUpSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().min(1).max(80),
    password: passwordSchema,
    targetLevel: z.enum(['N5', 'N4', 'N3', 'N2', 'N1'])
  })
  .strict()
const emailOnlySchema = z.object({ email: emailSchema }).strict()
const tokenOnlySchema = z
  .object({ token: z.string().min(1).max(MAX_TOKEN_LENGTH) })
  .strict()
const resetPasswordSchema = z
  .object({
    token: z.string().min(1).max(MAX_TOKEN_LENGTH),
    newPassword: passwordSchema
  })
  .strict()
const changePasswordSchema = z
  .object({ currentPassword: passwordSchema, newPassword: passwordSchema })
  .strict()
const emptySchema = z.object({}).strict()
const verificationJwtSchema = z
  .object({
    email: z.email().max(320),
    updateTo: z.undefined().optional(),
    requestType: z.undefined().optional()
  })
  .passthrough()

interface SignInCredentialRow {
  userId: string
  passwordHash: string
  emailVerified: boolean
  authorityGeneration: number
  role: 'USER' | 'ADMIN'
  accountStatus: 'ACTIVE' | 'DELETION_PENDING' | 'DELETED'
}

type SessionCredentialRow = Omit<SignInCredentialRow, 'emailVerified'>

interface IssuedSessionRow {
  id: string
  familyId: string
  createdAt: Date
  expiresAt: Date
  authorityGeneration: number
}

interface SignupCredentialRow {
  userId: string
  email: string
}

interface EmailVerificationSubjectRow extends SignupCredentialRow {
  name: string
  emailVerified: boolean
}

export interface Phase7AuthFacade {
  handle: (
    request: Request,
    pathname: string,
    payload: Record<string, unknown>
  ) => Promise<Response>
}

const response = (status: number, payload: Record<string, unknown>): Response =>
  Response.json(payload, { status })

const success = (cookies: readonly string[] = []): Response => {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers
  })
}

const invalidPayload = (): Response =>
  response(400, {
    code: 'INVALID_AUTH_PAYLOAD',
    message: 'Invalid auth payload.'
  })

const invalidCredential = (): Response =>
  response(401, {
    code: 'INVALID_EMAIL_OR_PASSWORD',
    message: 'Invalid email or password.'
  })

const unavailable = (): Response =>
  response(503, {
    code: 'AUTH_SERVICE_UNAVAILABLE',
    message: 'Authentication service is unavailable.'
  })

export const createPhase7AuthFacade = ({
  client,
  emailDispatcher,
  environment
}: {
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  emailDispatcher: AuthEmailDispatcher
  environment: ApiEnvironment
}): Phase7AuthFacade => {
  const isProduction = environment.NODE_ENV === 'production'
  const expiredCookies = (): readonly string[] =>
    createExpiredPhase7SessionCookies(isProduction)
  const spaOrigin =
    environment.TRUSTED_ORIGINS[0] ?? environment.BETTER_AUTH_URL

  const compensateIssuedSession = async (
    rawToken: string
  ): Promise<boolean> => {
    const rows = await client.$queryRawUnsafe<Array<{ signedOut: boolean }>>(
      'SELECT "phase7_owned_sign_out"($1) AS "signedOut"',
      rawToken
    )
    return rows.length === 1 && rows[0]?.signedOut === true
  }

  const sendVerification = async (
    subject: Pick<SignupCredentialRow, 'email'>
  ): Promise<void> => {
    const token = await createEmailVerificationToken(
      environment.BETTER_AUTH_SECRET,
      subject.email,
      undefined,
      ONE_HOUR_SECONDS
    )
    const verificationUrl = new URL('/verify-email', spaOrigin)
    verificationUrl.hash = new URLSearchParams({ token }).toString()
    emailDispatcher.enqueue({
      from: environment.AUTH_EMAIL_FROM,
      purpose: 'EMAIL_VERIFICATION',
      recipient: subject.email,
      url: verificationUrl.href
    })
  }

  const handlers: Record<
    string,
    (request: Request, payload: Record<string, unknown>) => Promise<Response>
  > = {
    '/api/auth/sign-in/email': async (request, payload) => {
      const parsed = signInSchema.safeParse(payload)
      if (!parsed.success) return invalidPayload()
      const rows = await client.$queryRawUnsafe<SignInCredentialRow[]>(
        'SELECT * FROM "phase7_resolve_sign_in_credential"($1)',
        parsed.data.email
      )
      const credential = rows.length === 1 ? rows[0] : undefined
      if (!credential) {
        await hashPassword(parsed.data.password)
        return invalidCredential()
      }
      if (
        !(await verifyPassword({
          hash: credential.passwordHash,
          password: parsed.data.password
        }))
      ) {
        return invalidCredential()
      }
      if (!credential.emailVerified) {
        await sendVerification({ email: parsed.data.email })
        return response(403, {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Email is not verified.'
        })
      }

      const sessionId = randomUUID()
      const rawToken = randomBytes(32).toString('base64url')
      let issued: IssuedSessionRow[]
      try {
        issued = await client.$queryRawUnsafe<IssuedSessionRow[]>(
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, $2, $3, $4, $5, $6, $7, $8, true
          )`,
          credential.userId,
          credential.authorityGeneration,
          credential.role,
          credential.accountStatus,
          sessionId,
          rawToken,
          request.headers.get(INTERNAL_CLIENT_IP_HEADER) ?? 'unresolved',
          (request.headers.get('User-Agent') ?? '').slice(0, 512)
        )
      } catch (error: unknown) {
        if (isStaleIssuerRace(error)) return invalidCredential()
        throw error
      }
      if (
        issued.length !== 1 ||
        issued[0]!.id !== sessionId ||
        issued[0]!.authorityGeneration !== credential.authorityGeneration
      ) {
        await compensateIssuedSession(rawToken)
        return unavailable()
      }

      let confirmationRows: Array<{ confirmed: boolean }>
      try {
        confirmationRows = await client.$queryRawUnsafe<
          Array<{ confirmed: boolean }>
        >(
          `SELECT "phase7_confirm_v1_session_issuance"(
            $1, $2, $3, $4, $5, $6
          ) AS "confirmed"`,
          rawToken,
          sessionId,
          credential.userId,
          credential.authorityGeneration,
          credential.role,
          credential.accountStatus
        )
      } catch {
        try {
          await compensateIssuedSession(rawToken)
        } catch {
          // The response remains fail-closed even when compensation is unavailable.
        }
        return unavailable()
      }
      const confirmed =
        confirmationRows.length === 1 &&
        typeof confirmationRows[0]?.confirmed === 'boolean'
          ? confirmationRows[0].confirmed
          : undefined
      if (confirmed !== true) {
        let compensated: boolean
        try {
          compensated = await compensateIssuedSession(rawToken)
        } catch {
          return unavailable()
        }
        if (!compensated) return unavailable()
        return confirmed === false ? invalidCredential() : unavailable()
      }

      return success([
        createPhase7SessionCookie({
          expiresAt: issued[0]!.expiresAt,
          isProduction,
          rememberMe: true,
          now: issued[0]!.createdAt,
          secret: environment.BETTER_AUTH_SECRET,
          token: rawToken
        })
      ])
    },

    '/api/auth/sign-out': async (_request, payload) => {
      if (!emptySchema.safeParse(payload).success) return invalidPayload()
      const credential = readPhase7SessionToken({
        cookieHeader: _request.headers.get('Cookie'),
        isProduction,
        secret: environment.BETTER_AUTH_SECRET
      })
      if (credential.token) {
        const rows = await client.$queryRawUnsafe<
          Array<{ signedOut: boolean }>
        >('SELECT "phase7_owned_sign_out"($1) AS "signedOut"', credential.token)
        if (rows.length !== 1 || rows[0]?.signedOut !== true)
          return unavailable()
      }
      return success(expiredCookies())
    },

    '/api/auth/change-password': async (request, payload) => {
      const parsed = changePasswordSchema.safeParse(payload)
      if (!parsed.success) return invalidPayload()
      const session = readPhase7SessionToken({
        cookieHeader: request.headers.get('Cookie'),
        isProduction,
        secret: environment.BETTER_AUTH_SECRET
      })
      if (!session.token) return response(401, { code: 'UNAUTHORIZED' })
      const rows = await client.$queryRawUnsafe<SessionCredentialRow[]>(
        'SELECT * FROM "phase7_resolve_session_credential"($1)',
        session.token
      )
      const credential = rows.length === 1 ? rows[0] : undefined
      if (
        !credential ||
        !(await verifyPassword({
          hash: credential.passwordHash,
          password: parsed.data.currentPassword
        })) ||
        (await verifyPassword({
          hash: credential.passwordHash,
          password: parsed.data.newPassword
        }))
      ) {
        return invalidCredential()
      }
      const nextHash = await hashPassword(parsed.data.newPassword)
      const changed = await client.$queryRawUnsafe<Array<{ changed: boolean }>>(
        `SELECT "phase7_change_password_v1"($1, $2, $3) AS "changed"`,
        session.token,
        credential.passwordHash,
        nextHash
      )
      if (changed.length !== 1 || changed[0]?.changed !== true) {
        return invalidCredential()
      }
      return success(expiredCookies())
    },

    '/api/auth/request-password-reset': async (_request, payload) => {
      const parsed = emailOnlySchema.safeParse(payload)
      if (!parsed.success) return invalidPayload()
      await hashPassword('phase7-reset-dummy-password')
      const rawToken = randomBytes(32).toString('base64url')
      const issued = await client.$queryRawUnsafe<Array<{ issued: boolean }>>(
        `SELECT "phase7_request_password_reset"($1, $2, $3)
          AS "issued"`,
        parsed.data.email,
        randomUUID(),
        rawToken
      )
      if (issued.length !== 1 || typeof issued[0]?.issued !== 'boolean')
        return unavailable()
      if (issued[0].issued) {
        const resetUrl = new URL('/reset-password', spaOrigin)
        resetUrl.hash = new URLSearchParams({ token: rawToken }).toString()
        emailDispatcher.enqueue({
          from: environment.AUTH_EMAIL_FROM,
          purpose: 'PASSWORD_RESET',
          recipient: parsed.data.email,
          url: resetUrl.href
        })
      }
      return success()
    },

    '/api/auth/reset-password': async (_request, payload) => {
      const parsed = resetPasswordSchema.safeParse(payload)
      if (!parsed.success) return invalidPayload()
      const credentials = await client.$queryRawUnsafe<
        Array<{
          userId: string
          passwordHash: string
          authorityGeneration: number
        }>
      >(
        'SELECT * FROM "phase7_resolve_password_reset_credential"($1)',
        parsed.data.token
      )
      const credential = credentials.length === 1 ? credentials[0] : undefined
      if (
        !credential ||
        (await verifyPassword({
          hash: credential.passwordHash,
          password: parsed.data.newPassword
        }))
      ) {
        return response(400, { code: 'INVALID_TOKEN' })
      }
      const nextHash = await hashPassword(parsed.data.newPassword)
      const reset = await client.$queryRawUnsafe<
        Array<{ userId: string; authorityGeneration: number }>
      >(
        'SELECT * FROM "phase7_consume_password_reset"($1, $2)',
        parsed.data.token,
        nextHash
      )
      if (reset.length !== 1 || reset[0]?.userId !== credential.userId) {
        return response(400, { code: 'INVALID_TOKEN' })
      }
      return success(expiredCookies())
    },

    '/api/auth/sign-up/email': async (_request, payload) => {
      const parsed = signUpSchema.safeParse(payload)
      if (!parsed.success) return invalidPayload()
      const passwordHash = await hashPassword(parsed.data.password)
      const userId = randomUUID()
      const rows = await client.$queryRawUnsafe<SignupCredentialRow[]>(
        `SELECT * FROM "phase7_sign_up_credential"(
          $1, $2, $3, $4, $5, $6
        )`,
        userId,
        randomUUID(),
        parsed.data.email,
        parsed.data.name,
        parsed.data.targetLevel,
        passwordHash
      )
      if (rows.length === 1) await sendVerification(rows[0]!)
      return success()
    },

    '/api/auth/send-verification-email': async (_request, payload) => {
      const parsed = emailOnlySchema.safeParse(payload)
      if (!parsed.success) return invalidPayload()
      const rows = await client.$queryRawUnsafe<EmailVerificationSubjectRow[]>(
        'SELECT * FROM "phase7_resolve_email_verification_subject"($1)',
        parsed.data.email
      )
      if (rows.length === 1 && !rows[0]!.emailVerified) {
        await sendVerification(rows[0]!)
      } else {
        await createEmailVerificationToken(
          environment.BETTER_AUTH_SECRET,
          parsed.data.email,
          undefined,
          ONE_HOUR_SECONDS
        )
      }
      return success()
    },

    '/api/auth/verify-email': async (_request, payload) => {
      const parsed = tokenOnlySchema.safeParse(payload)
      if (!parsed.success) return invalidPayload()
      const jwt = verificationJwtSchema.safeParse(
        await verifyJWT(parsed.data.token, environment.BETTER_AUTH_SECRET)
      )
      if (!jwt.success) return response(400, { code: 'INVALID_TOKEN' })
      const email = jwt.data.email.toLowerCase()
      const subjects = await client.$queryRawUnsafe<
        EmailVerificationSubjectRow[]
      >('SELECT * FROM "phase7_resolve_email_verification_subject"($1)', email)
      if (subjects.length !== 1) return response(400, { code: 'INVALID_TOKEN' })
      const verified = await client.$queryRawUnsafe<
        Array<{ verified: boolean }>
      >(
        'SELECT "phase7_verify_email"($1, $2) AS "verified"',
        subjects[0]!.userId,
        email
      )
      return verified.length === 1 && verified[0]?.verified === true
        ? success()
        : response(400, { code: 'INVALID_TOKEN' })
    }
  }

  return {
    handle: async (request, pathname, payload) => {
      const handler = handlers[pathname]
      if (!handler) return response(404, { code: 'AUTH_ROUTE_NOT_FOUND' })
      try {
        return await handler(request, payload)
      } catch {
        return unavailable()
      }
    }
  }
}
