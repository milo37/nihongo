import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { Client } from 'pg'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'

export interface Phase7BrowserCredentials {
  readonly email: string
  readonly name: string
  readonly password: string
  readonly userId: string
}

export interface Phase7BrowserFixture {
  readonly author: Phase7BrowserCredentials
  readonly insightsLearner: Phase7BrowserCredentials
  readonly learner: Phase7BrowserCredentials
  readonly reviewer: Phase7BrowserCredentials
}

interface Phase7BrowserDatabaseSnapshot {
  readonly account: number
  readonly audit: number
  readonly operationIntent: number
  readonly option: number
  readonly question: number
  readonly reauthenticationFinalized: number
  readonly reauthenticationIntent: number
  readonly report: number
  readonly review: number
  readonly rotationFence: number
  readonly user: number
  readonly version: number
  readonly versionTag: number
}

export interface Phase7BrowserFixtureDatabase {
  readonly ageFreshAssurance: (userId: string) => Promise<void>
  readonly assertExpectedLifecycleDelta: (
    before: Phase7BrowserDatabaseSnapshot
  ) => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly snapshot: () => Promise<Phase7BrowserDatabaseSnapshot>
}

const createCredentials = (
  schemaName: string,
  actor: 'author' | 'insights' | 'learner' | 'reviewer',
  name: string
): Phase7BrowserCredentials => {
  const suffix = schemaName.slice('phase7_'.length, 'phase7_'.length + 12)
  return {
    email: `phase7-${actor}-${suffix}@example.test`,
    name,
    password: `Phase7-${actor}-${randomBytes(12).toString('base64url')}!9a`,
    userId: randomUUID()
  }
}

const createFixtureClient = (databaseUrl: string): Client => {
  const schemaName = getPostgresSchema(databaseUrl)
  if (!schemaName || !/^phase7_[a-f0-9]{32}_test$/u.test(schemaName)) {
    throw new Error('Phase 7 browser fixture schema is unsafe.')
  }
  const connectionUrl = new URL(databaseUrl)
  connectionUrl.searchParams.delete('schema')
  connectionUrl.searchParams.delete('options')
  return new Client({
    connectionString: connectionUrl.toString(),
    options: createPostgresStartupOptions(schemaName)
  })
}

const readSnapshot = async (
  client: Client
): Promise<Phase7BrowserDatabaseSnapshot> => {
  const result = await client.query<Phase7BrowserDatabaseSnapshot>(
    `SELECT
       (SELECT COUNT(*)::int FROM "User") AS "user",
       (SELECT COUNT(*)::int FROM "Account") AS "account",
       (SELECT COUNT(*)::int FROM "Question") AS "question",
       (SELECT COUNT(*)::int FROM "QuestionVersion") AS "version",
       (SELECT COUNT(*)::int FROM "QuestionOption") AS "option",
       (SELECT COUNT(*)::int FROM "QuestionVersionTag") AS "versionTag",
       (SELECT COUNT(*)::int FROM "ContentReview") AS "review",
       (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "audit",
       (SELECT COUNT(*)::int FROM "AuthSessionRotationFence") AS "rotationFence",
       (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent")
         AS "reauthenticationIntent",
       (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent"
         WHERE "state" = 'FINALIZED') AS "reauthenticationFinalized",
       (SELECT COUNT(*)::int FROM "Phase7OperationIntent") AS "operationIntent",
       (SELECT COUNT(*)::int FROM "QuestionReport") AS "report"`
  )
  const snapshot = result.rows[0]
  if (!snapshot) {
    throw new Error('Phase 7 browser database snapshot is unavailable.')
  }
  return snapshot
}

const withFixtureClient = async <Result>(
  databaseUrl: string,
  operation: (client: Client) => Promise<Result>
): Promise<Result> => {
  const client = createFixtureClient(databaseUrl)
  await client.connect()
  try {
    return await operation(client)
  } finally {
    await client.end()
  }
}

const assertDelta = (
  before: Phase7BrowserDatabaseSnapshot,
  after: Phase7BrowserDatabaseSnapshot,
  key: keyof Phase7BrowserDatabaseSnapshot,
  expected: number
): void => {
  const actual = after[key] - before[key]
  if (actual !== expected) {
    throw new Error(
      `Phase 7 browser database delta mismatch for ${key}: expected ${expected}, received ${actual}.`
    )
  }
}

export const createPhase7BrowserFixture = async (
  databaseUrl: string
): Promise<{
  readonly database: Phase7BrowserFixtureDatabase
  readonly fixture: Phase7BrowserFixture
}> => {
  const schemaName = getPostgresSchema(databaseUrl)
  if (!schemaName) {
    throw new Error('Phase 7 browser fixture schema is missing.')
  }
  const client = createFixtureClient(databaseUrl)
  await client.connect()

  const fixture: Phase7BrowserFixture = {
    author: createCredentials(schemaName, 'author', 'Phase 7 작성 관리자'),
    insightsLearner: createCredentials(
      schemaName,
      'insights',
      'Phase 8 인사이트 학습자'
    ),
    learner: createCredentials(schemaName, 'learner', 'Phase 7 학습자'),
    reviewer: createCredentials(schemaName, 'reviewer', 'Phase 7 검수 관리자')
  }

  try {
    await client.query('BEGIN')
    for (const [credentials, role, targetLevel] of [
      [fixture.author, 'ADMIN', 'N3'],
      [fixture.reviewer, 'ADMIN', 'N3'],
      [fixture.learner, 'USER', 'N3'],
      [fixture.insightsLearner, 'USER', 'N2']
    ] as const) {
      await client.query(
        `INSERT INTO "User" (
           "id", "name", "email", "emailVerified", "role", "targetLevel",
           "accountStatus", "authorityGeneration", "createdAt", "updatedAt"
         ) VALUES (
           $1::uuid, $2, $3, TRUE, $4::"UserRole", $5::"JlptLevel", 'ACTIVE', 1,
           clock_timestamp(), clock_timestamp()
         )`,
        [
          credentials.userId,
          credentials.name,
          credentials.email,
          role,
          targetLevel
        ]
      )
      await client.query(
        `INSERT INTO "Account" (
           "id", "accountId", "providerId", "userId", "password",
           "createdAt", "updatedAt"
         ) VALUES (
           $1::uuid, $2, 'credential', $3::uuid, $4,
           clock_timestamp(), clock_timestamp()
         )`,
        [
          randomUUID(),
          credentials.userId,
          credentials.userId,
          await hashPassword(credentials.password)
        ]
      )
    }
    await client.query('COMMIT')
  } catch (error: unknown) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }

  let disconnected = false
  const runWithFixtureClient = async <Result>(
    operation: (operationClient: Client) => Promise<Result>
  ): Promise<Result> => {
    if (disconnected) {
      throw new Error('Phase 7 browser fixture database is disconnected.')
    }
    return await withFixtureClient(databaseUrl, operation)
  }

  return {
    fixture,
    database: {
      ageFreshAssurance: async (userId): Promise<void> => {
        await runWithFixtureClient(async (operationClient) => {
          await operationClient.query('BEGIN')
          try {
            await operationClient.query(
              'SET LOCAL session_replication_role = replica'
            )
            const updated = await operationClient.query(
              `UPDATE "Session"
               SET "createdAt" = clock_timestamp() - INTERVAL '6 minutes'
               WHERE "userId" = $1::uuid
                 AND "issuerProtocolVersion" = 'PHASE7_V1'
                 AND "authorizationState" = 'ACTIVE'`,
              [userId]
            )
            if (updated.rowCount !== 1) {
              throw new Error(
                `Phase 7 fresh-assurance fixture expected one active session, received ${updated.rowCount ?? 0}.`
              )
            }
            await operationClient.query(
              'SET LOCAL session_replication_role = origin'
            )
            await operationClient.query('COMMIT')
          } catch (error: unknown) {
            await operationClient.query('ROLLBACK')
            throw error
          }
        })
      },
      assertExpectedLifecycleDelta: async (before): Promise<void> => {
        const after = await runWithFixtureClient(readSnapshot)
        assertDelta(before, after, 'user', 0)
        assertDelta(before, after, 'account', 0)
        assertDelta(before, after, 'question', 2)
        assertDelta(before, after, 'version', 3)
        assertDelta(before, after, 'option', 12)
        assertDelta(before, after, 'versionTag', 3)
        assertDelta(before, after, 'review', 12)
        assertDelta(before, after, 'audit', 25)
        assertDelta(before, after, 'rotationFence', 1)
        assertDelta(before, after, 'reauthenticationIntent', 1)
        assertDelta(before, after, 'reauthenticationFinalized', 1)
        assertDelta(before, after, 'operationIntent', 0)
        assertDelta(before, after, 'report', 1)
      },
      disconnect: async (): Promise<void> => {
        disconnected = true
      },
      snapshot: async (): Promise<Phase7BrowserDatabaseSnapshot> =>
        await runWithFixtureClient(readSnapshot)
    }
  }
}
