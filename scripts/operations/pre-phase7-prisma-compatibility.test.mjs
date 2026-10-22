import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const apiDirectory = path.join(repositoryRoot, 'apps', 'api')

const compilerProbe = String.raw`
import { PrismaClient } from './src/generated/prisma/client.ts'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { selectDatabaseGlobalOmit } from './src/db/database.ts'

class CapturingPool extends pg.Pool {
  constructor() {
    super({ max: 1 })
    this.statements = []
  }

  on() {
    return this
  }

  removeListener() {
    return this
  }

  async end() {}

  async query(query) {
    const statement = typeof query === 'string' ? query : query.text
    this.statements.push(statement)
    return { fields: [], rowCount: 1, rows: [] }
  }
}

const pool = new CapturingPool()
const client = new PrismaClient({
  adapter: new PrismaPg(pool),
  omit: selectDatabaseGlobalOmit('pre-phase7')
})
const now = new Date('2026-01-01T00:00:00.000Z')

await client.user.create({
  data: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Legacy',
    email: 'legacy@example.test',
    emailVerified: false,
    image: null,
    role: 'USER',
    targetLevel: 'N5',
    accountStatus: 'ACTIVE',
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  }
}).catch(() => undefined)
await client.session.create({
  data: {
    id: '00000000-0000-4000-8000-000000000002',
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    token: 'legacy-token',
    createdAt: now,
    updatedAt: now,
    ipAddress: null,
    userAgent: null,
    userId: '00000000-0000-4000-8000-000000000001'
  }
}).catch(() => undefined)
await client.$disconnect()

const forbidden = /authorityGeneration|sessionFamilyId|issuerProtocolVersion|authorizationState|AuthSessionIssuerProtocolVersion|AuthSessionAuthorizationState/u
if (pool.statements.some((statement) => forbidden.test(statement))) {
  throw new Error('Phase 7 SQL leaked into pre-Phase-7 create SQL.')
}
if (!pool.statements.some((statement) => /INSERT INTO "public"\."User"/u.test(statement))) {
  throw new Error('User INSERT was not captured.')
}
if (!pool.statements.some((statement) => /INSERT INTO "public"\."Session"/u.test(statement))) {
  throw new Error('Session INSERT was not captured.')
}
`

test('pre-Phase-7 Prisma writes compile without Phase 7 columns or enum casts', () => {
  const generate = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:generate'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 30_000
    }
  )
  assert.equal(
    generate.status,
    0,
    `Prisma generation failed.\nstdout:\n${generate.stdout}\nstderr:\n${generate.stderr}`
  )

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', compilerProbe],
    {
      cwd: apiDirectory,
      encoding: 'utf8',
      timeout: 30_000
    }
  )

  assert.equal(
    result.status,
    0,
    `Prisma compatibility probe failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  )
})
