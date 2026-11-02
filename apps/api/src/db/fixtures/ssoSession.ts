import { randomUUID } from 'node:crypto'
import type { SsoVerifiedIdentity } from '../../auth/ssoProtocol.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { createSsoIdentityRepository } from '../../auth/ssoIdentityRepository.js'
import { createSessionCookie } from '../../auth/sessionCookie.js'

export const createPhase7SsoIdentityFixture = async ({
  owner,
  role = 'USER',
  existingUser
}: {
  owner: {
    $queryRawUnsafe: <T = unknown>(
      sql: string,
      ...values: unknown[]
    ) => Promise<T>
  }
  role?: 'USER' | 'ADMIN'
  existingUser?: { id: string; email: string; name: string }
}) => {
  const userId = existingUser?.id ?? randomUUID()
  const email =
    existingUser?.email ?? `sso-fixture-${randomUUID()}@example.test`
  const name = existingUser?.name ?? `SSO fixture ${role}`
  const subject = `sso-fixture-${randomUUID()}`
  if (existingUser) {
    await owner.$queryRawUnsafe(
      `INSERT INTO "Account" (id,"accountId","providerId","userId","createdAt","updatedAt") VALUES ($1,$2,'google',$3,clock_timestamp(),clock_timestamp()) RETURNING "userId"`,
      randomUUID(),
      subject,
      userId
    )
  } else {
    await owner.$queryRawUnsafe(
      `WITH actor AS (INSERT INTO "User" (id,name,email,"emailVerified",role,"accountStatus","createdAt","updatedAt") VALUES ($1,$2,$3,true,$4::"UserRole",'ACTIVE',clock_timestamp(),clock_timestamp()) RETURNING id) INSERT INTO "Account" (id,"accountId","providerId","userId","createdAt","updatedAt") SELECT $5,$6,'google',actor.id,clock_timestamp(),clock_timestamp() FROM actor RETURNING "userId"`,
      userId,
      name,
      email,
      role,
      randomUUID(),
      subject
    )
  }
  const identity: SsoVerifiedIdentity = {
    provider: 'google',
    accountId: subject,
    email,
    name
  }
  return { userId, identity }
}

export const createPhase7SsoSessionFixture = async ({
  owner,
  gateway,
  secret,
  role = 'USER',
  existingUser
}: {
  owner: {
    $queryRawUnsafe: <T = unknown>(
      sql: string,
      ...values: unknown[]
    ) => Promise<T>
  }
  gateway: Pick<PrismaClient, '$queryRawUnsafe'>
  secret: string
  role?: 'USER' | 'ADMIN'
  existingUser?: { id: string; email: string; name: string }
}) => {
  const { userId, identity } = await createPhase7SsoIdentityFixture({
    owner,
    role,
    ...(existingUser ? { existingUser } : {})
  })
  const session = await createSsoIdentityRepository(gateway).signIn(identity, {
    ipAddress: '127.0.0.1',
    userAgent: 'sso-integration-fixture'
  })
  if (session.kind !== 'SESSION_CONFIRMED') {
    throw new Error('SSO session fixture was not confirmed.')
  }
  const serialized = createSessionCookie({
    token: session.token,
    expiresAt: session.expiresAt,
    isProduction: false,
    rememberMe: true,
    secret
  })
  return {
    userId,
    identity,
    token: session.token,
    cookie: serialized.split(';', 1)[0]!
  }
}
