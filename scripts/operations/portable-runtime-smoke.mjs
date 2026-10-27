#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertReleaseId } from './release-contract.mjs'
import { writeManifestAtomically } from './release-manifest.mjs'
import {
  isCanonicalViteAssetPath,
  runPostDeploySmoke
} from './post-deploy-smoke.mjs'
import {
  parseUniqueKeyJson,
  readBoundedUniqueKeyJsonFile
} from './json-boundary.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const postgresImage =
  'postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'
const currentMigrationCount = 48
const currentMigrationDigest =
  '1fb4dfe08954a0200eb0d11073b7128c6f1658658afb7a73881b766dc30db9c2'
const lastBootstrapMigration =
  '20261009092000_phase7_n4_n2_revision2_digest_fix'
const migrationLogin = 'nihongo_test_phase7_migration_login'
const applicationLogin = 'nihongo_test_app_login'
const gatewayLogin = 'nihongo_test_auth_gateway_login'
const schemaPattern = /^phase7_[0-9a-f]{32}_test$/u
const sha256Pattern = /^[0-9a-f]{64}$/u
const imageIdPattern = /^sha256:[0-9a-f]{64}$/u
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const assertExactKeys = (value, expectedKeys, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const actualKeys = Object.keys(value).sort()
  const exactKeys = [...expectedKeys].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(exactKeys)) {
    throw new Error(`${label} has an invalid key set.`)
  }
}

export const isCanonicalRuntimeAssetPath = (path) =>
  isCanonicalViteAssetPath(path)

const canonicalSeedPhases = new Set([
  'host-input',
  'host-prisma-adapter',
  'host-prisma-client',
  'host-seed-module',
  'host-guard-module',
  'host-options-module',
  'test-target',
  'client-setup',
  'seed-transaction',
  'seed-owner-role',
  'canonical-seed',
  'seed-count',
  'seed-role-boundary',
  'disconnect',
  'host-seed'
])
const canonicalSeedErrorCodes = new Set([
  'ERR_MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_DLOPEN_FAILED',
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1010',
  'P1012',
  'P1014',
  'P1017',
  'P2002',
  'P2003',
  'P2010',
  'P2021',
  'P2022',
  'P2024',
  'P2034',
  '42501',
  '42P01',
  '42703',
  '40001',
  '40P01',
  '28P01',
  '08006',
  'UNCLASSIFIED'
])

export const readSafeCanonicalSeedFailure = (stderr) => {
  for (const line of (typeof stderr === 'string' ? stderr : '').split('\n')) {
    if (!line.startsWith('PORTABLE_TEST_SETUP ')) continue
    try {
      const value = JSON.parse(line.slice('PORTABLE_TEST_SETUP '.length))
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const keys = Object.keys(value).sort().join(',')
      if (keys !== 'code,phase' && keys !== 'code,databaseCode,phase') continue
      if (
        !canonicalSeedPhases.has(value.phase) ||
        !canonicalSeedErrorCodes.has(value.code)
      )
        continue
      if (
        value.databaseCode !== undefined &&
        !canonicalSeedErrorCodes.has(value.databaseCode)
      )
        continue
      return (
        'phase=' +
        value.phase +
        ' code=' +
        value.code +
        (value.databaseCode ? ' databaseCode=' + value.databaseCode : '')
      )
    } catch {
      // Unframed or malformed child output is never included in diagnostics.
    }
  }
  return 'phase=host-seed code=UNCLASSIFIED'
}

export const assertHostPrismaClient = (
  apiDirectory = join(repositoryRoot, 'apps/api')
) => {
  let ready = false
  try {
    ready = statSync(
      join(apiDirectory, 'src/generated/prisma/client.ts')
    ).isFile()
  } catch {
    // Report only the fixed prerequisite path, never a filesystem error payload.
  }
  if (!ready)
    throw new Error(
      'Reviewed canonical65 TEST setup failed: phase=host-prisma-client code=HOST_PRISMA_CLIENT_UNAVAILABLE path=apps/api/src/generated/prisma/client.ts; run pnpm run db:generate on the host.'
    )
}

const run = (command, argumentsList, options = {}) => {
  const result = spawnSync(command, argumentsList, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 20 * 1024 * 1024,
    stdio: options.input === undefined ? 'pipe' : ['pipe', 'pipe', 'pipe']
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    const stderrTail = options.safeCanonicalSeedFailure
      ? readSafeCanonicalSeedFailure(result.stderr)
      : options.includeStderr
        ? (result.stderr ?? '').trim().slice(-2_000)
        : ''
    throw new Error(
      `${options.failureLabel ?? command} failed with exit code ${result.status ?? 'unknown'}.` +
        (stderrTail ? `\n${stderrTail}` : '')
    )
  }
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? ''
  }
}

const wait = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

const parseArguments = (argumentsList) => {
  const values = new Map()
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!key?.startsWith('--') || value === undefined || values.has(key)) {
      throw new Error(
        'Runtime smoke arguments must be unique --key value pairs.'
      )
    }
    values.set(key, value)
  }
  return values
}

const requiredArgument = (argumentsMap, name) => {
  const value = argumentsMap.get(name)
  if (!value) throw new Error(`Missing required argument: ${name}`)
  return value
}

export const selectCurrentMigrationNames = (migrationsDirectory) => {
  const manifest = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      checksum: createHash('sha256')
        .update(readFileSync(join(migrationsDirectory, name, 'migration.sql')))
        .digest('hex')
    }))
  if (
    manifest.length !== currentMigrationCount ||
    createHash('sha256').update(JSON.stringify(manifest)).digest('hex') !==
      currentMigrationDigest ||
    manifest[36]?.name !== lastBootstrapMigration ||
    manifest.at(-1)?.name !== '20261028090000_sso_account_erasure_worker_queue'
  ) {
    throw new Error('Repository current-48 migration inventory is invalid.')
  }
  return manifest.map(({ name }) => name)
}

export const selectLearnerCompatibilityFixture = (questions) => {
  if (!Array.isArray(questions) || questions.length !== 65) {
    throw new Error(
      'Canonical question catalog must contain exactly 65 questions.'
    )
  }
  const question = questions.find(
    ({ questionId }) => questionId === '565d941a-3f60-4e7d-8d87-01a467eacfad'
  )
  const tag = question?.tags.find(
    ({ id }) =>
      questions.filter((candidate) =>
        candidate.tags.some((item) => item.id === id)
      ).length === 1
  )
  if (
    !question ||
    !tag ||
    question.level !== 'N5' ||
    [...question.questionText].length > 160
  ) {
    throw new Error(
      'Canonical learner fixture requires an existing unique tag and exact preview.'
    )
  }
  return {
    questionId: question.questionId,
    versionId: question.versionId,
    questionText: question.questionText,
    difficulty: question.difficulty,
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    tags: question.tags.map(({ id, label }) => ({ id, label })),
    tagId: tag.id,
    tagLabel: tag.label
  }
}

const testSetupEnvironment = () =>
  Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'SystemRoot']
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]])
  )

export const readCanonicalLearnerFixture = (runCommand = run) => {
  const source = `
    import { buildAllQuestionSeeds } from './prisma/seedQuestionCatalog.ts';
    import { selectLearnerCompatibilityFixture } from '../../scripts/operations/portable-runtime-smoke.mjs';
    console.log(JSON.stringify(selectLearnerCompatibilityFixture(buildAllQuestionSeeds())));
  `
  const result = runCommand(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', source],
    {
      cwd: join(repositoryRoot, 'apps/api'),
      env: testSetupEnvironment(),
      failureLabel: 'Reviewed canonical catalog inspection'
    }
  )
  return parseUniqueKeyJson(result.stdout.trim())
}

export const createRuntimeEnvironment = ({
  databaseHost,
  databaseName,
  databasePassword,
  gatewayPassword,
  schemaName,
  releaseId
}) => {
  if (
    !schemaPattern.test(schemaName) ||
    !/^[a-z_][a-z0-9_]*_test$/u.test(databaseName) ||
    !/^[a-z0-9-]+$/u.test(databaseHost) ||
    !/^[a-f0-9]{48}$/u.test(databasePassword) ||
    !/^[a-f0-9]{48}$/u.test(gatewayPassword) ||
    databasePassword === gatewayPassword
  ) {
    throw new Error('Isolated owned-auth TEST database inputs are invalid.')
  }
  const databaseUrl = (login, password) =>
    `postgresql://${login}:${password}@${databaseHost}:5432/${databaseName}?schema=${schemaName}&sslmode=verify-full`
  return {
    ADMIN_CMS_MODE: 'disabled',
    AUTH_GATEWAY_DATABASE_URL: databaseUrl(gatewayLogin, gatewayPassword),
    AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: 'https://smoke.invalid',
    DATABASE_URL: databaseUrl(applicationLogin, databasePassword),
    DEPLOYMENT_ENVIRONMENT: 'TEST',
    GUEST_COOKIE_SECRET: randomBytes(32).toString('hex'),
    HOST: '0.0.0.0',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'production',
    NODE_EXTRA_CA_CERTS: '/certs/server.crt',
    PORT: '3001',
    PRACTICE_CONTRACT_RUNTIME: 'v1-v2',
    RELEASE_ID: assertReleaseId(releaseId),
    TRUSTED_ORIGINS: 'https://smoke.invalid'
  }
}

export const createPostgresCertificateArguments = (
  databaseHost,
  certificateDirectory
) => [
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-sha256',
  '-days',
  '1',
  '-nodes',
  '-subj',
  '/CN=postgres',
  '-addext',
  `subjectAltName=DNS:${databaseHost},DNS:localhost,IP:127.0.0.1`,
  '-keyout',
  join(certificateDirectory, 'server.key'),
  '-out',
  join(certificateDirectory, 'server.crt')
]

export const createRuntimePublicCertificateArguments = (
  certificateDirectory
) => [
  '--volume',
  `${join(certificateDirectory, 'server.crt')}:/certs/server.crt:ro`
]

export const createPostgresReadinessArguments = (
  containerName,
  databaseUser,
  databaseName
) => [
  'exec',
  containerName,
  'pg_isready',
  '-h',
  '127.0.0.1',
  '-U',
  databaseUser,
  '-d',
  databaseName
]

const waitForPostgres = async (containerName, databaseUser, databaseName) => {
  let lastStatus = 'unknown'
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = run(
      'docker',
      createPostgresReadinessArguments(
        containerName,
        databaseUser,
        databaseName
      ),
      { allowFailure: true }
    )
    if (result.status === 0) return
    lastStatus = String(result.status)
    await wait(500)
  }
  throw new Error(
    `Isolated PostgreSQL did not become ready (last probe exit ${lastStatus}).`
  )
}

const databaseCommand = (
  { containerName, databaseName, databaseUser, password, schemaName },
  input
) =>
  run(
    'docker',
    [
      'exec',
      '-i',
      '--env',
      `PGPASSWORD=${password}`,
      ...(schemaName
        ? [
            '--env',
            `PGOPTIONS=-c search_path=${schemaName} -c role=nihongo_phase7_migration -c TimeZone=UTC`
          ]
        : []),
      containerName,
      'psql',
      '-X',
      '-q',
      '-A',
      '-t',
      '-h',
      containerName,
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      databaseUser,
      '-d',
      databaseName
    ],
    { input, failureLabel: 'Isolated TEST database preparation' }
  )

const provisionRuntimeIdentity = (database, schemaName, passwords) => {
  const groups = [
    'nihongo_phase7_owner',
    'nihongo_phase7_migration',
    'nihongo_app',
    'nihongo_auth_gateway',
    'nihongo_erasure_worker'
  ]
  const sql = groups.map(
    (role) =>
      `CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`
  )
  sql.push(
    'GRANT "nihongo_phase7_owner" TO "nihongo_phase7_migration" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;'
  )
  for (const prefix of ['nihongo_test', 'nihongo_development']) {
    for (const [suffix, group] of [
      ['phase7_migration', 'nihongo_phase7_migration'],
      ['app', 'nihongo_app'],
      ['auth_gateway', 'nihongo_auth_gateway'],
      ['erasure_worker', 'nihongo_erasure_worker'],
      ['legacy_app', null]
    ]) {
      const role = `${prefix}_${suffix}_login`
      const password = passwords[role] ?? randomBytes(24).toString('hex')
      sql.push(
        `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`
      )
      if (group)
        sql.push(
          `GRANT "${group}" TO "${role}" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;`
        )
    }
  }
  sql.push(`CREATE EXTENSION pgcrypto WITH SCHEMA public;
    ALTER DATABASE "${database.databaseName}" OWNER TO "nihongo_phase7_migration";
    REVOKE ALL PRIVILEGES ON DATABASE "${database.databaseName}" FROM PUBLIC, "${database.databaseUser}", "nihongo_phase7_migration";
    GRANT CREATE, TEMPORARY ON DATABASE "${database.databaseName}" TO "nihongo_phase7_migration";
    GRANT CONNECT ON DATABASE "${database.databaseName}" TO "${migrationLogin}", "${applicationLogin}", "${gatewayLogin}", "nihongo_test_erasure_worker_login", "nihongo_test_legacy_app_login";
    CREATE SCHEMA "${schemaName}" AUTHORIZATION "nihongo_phase7_migration";`)
  databaseCommand(database, sql.join('\n'))
}

const applyCurrentMigrations = (
  database,
  migrationsDirectory,
  names,
  initialize = false
) => {
  if (initialize)
    databaseCommand(
      database,
      `CREATE TABLE "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0);`
    )
  for (const name of names) {
    const sql = readFileSync(join(migrationsDirectory, name, 'migration.sql'))
    databaseCommand(database, sql)
    const checksum = createHash('sha256').update(sql).digest('hex')
    databaseCommand(
      database,
      `INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
      VALUES ('${randomUUID()}', '${checksum}', now(), '${name}', now(), 1);`
    )
  }
}

// TEST setup stays on the host; the production image and server are unchanged.
export const canonicalSeedProgram = `
import { readFileSync } from 'node:fs';
let phase = 'host-input';
let client;
const allowedCodes = new Set(${JSON.stringify([...canonicalSeedErrorCodes])});
const reportFailure = (error) => {
  const code = allowedCodes.has(error?.code) ? error.code : 'UNCLASSIFIED';
  const databaseCode = allowedCodes.has(error?.meta?.code) ? error.meta.code : undefined;
  process.stderr.write('PORTABLE_TEST_SETUP ' + JSON.stringify({
    phase, code, ...(databaseCode ? { databaseCode } : {})
  }) + '\\n');
  process.exitCode = 1;
};
try {
  const { databaseUrl, runtimeDatabaseUrl } = JSON.parse(readFileSync(0, 'utf8'));
  phase = 'host-prisma-adapter';
  const { PrismaPg } = await import('@prisma/adapter-pg');
  phase = 'host-prisma-client';
  const { PrismaClient } = await import('./src/generated/prisma/client.ts');
  phase = 'host-seed-module';
  const { seedQuestionCatalog } = await import('./prisma/seedQuestionCatalog.ts');
  phase = 'host-guard-module';
  const { assertSafePhase7MigrationDatabase } = await import('./src/db/databaseTargetGuard.ts');
  phase = 'host-options-module';
  const { createPostgresStartupOptions, getPostgresSchema } = await import('./src/db/databaseOptions.ts');
  phase = 'test-target';
  const migrationUrl = new URL(databaseUrl);
  migrationUrl.searchParams.set('options', '-c role=nihongo_phase7_migration');
  const productionSentinel = new URL(databaseUrl);
  productionSentinel.pathname = '/nihongo_phase11_production_guard_sentinel';
  productionSentinel.search = '';
  assertSafePhase7MigrationDatabase({ nodeEnvironment: 'test', migrationDatabaseUrl: migrationUrl.toString(),
    runtimeDatabaseUrl, productionDatabaseUrl: productionSentinel.toString() });
  const schema = getPostgresSchema(databaseUrl);
  if (new URL(databaseUrl).hostname !== '127.0.0.1' || !/^phase7_[a-f0-9]{32}_test$/.test(schema))
    throw new Error('Controlled TEST seed target is invalid.');
  phase = 'client-setup';
  client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl,
    options: createPostgresStartupOptions(schema, 'nihongo_phase7_migration') }, { schema }) });
  phase = 'seed-transaction';
  const result = await client.$transaction(async (transaction) => {
    phase = 'seed-owner-role';
    await transaction.$executeRawUnsafe('SET LOCAL ROLE nihongo_phase7_owner');
    const roles = await transaction.$queryRawUnsafe('SELECT current_user AS role, session_user AS login');
    if (roles.length !== 1 || roles[0].role !== 'nihongo_phase7_owner' || roles[0].login !== 'nihongo_test_phase7_migration_login')
      throw new Error('Controlled TEST seed role attestation failed.');
    const scoped = new Proxy(transaction, { get(target, property, receiver) {
      return property === '$transaction' ? async (callback) => await callback(transaction) : Reflect.get(target, property, receiver);
    } });
    phase = 'canonical-seed';
    return await seedQuestionCatalog(scoped);
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 60000 });
  phase = 'seed-count';
  if (result.insertedCount !== 65 || result.verifiedCount !== 0)
    throw new Error('Controlled TEST canonical seed count is invalid.');
  phase = 'seed-role-boundary';
  const roles = await client.$queryRawUnsafe('SELECT current_user AS role');
  if (roles.length !== 1 || roles[0].role !== 'nihongo_phase7_migration')
    throw new Error('Controlled TEST seed role boundary did not close.');
} catch (error) {
  reportFailure(error);
} finally {
  if (client) {
    phase = 'disconnect';
    try { await client.$disconnect(); } catch (error) { reportFailure(error); }
  }
}
`

export const seedLearnerCompatibilityFixture = (
  databaseUrl,
  runtimeDatabaseUrl,
  caCertificatePath
) => {
  assertHostPrismaClient()
  return run(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', canonicalSeedProgram],
    {
      cwd: join(repositoryRoot, 'apps/api'),
      env: {
        ...testSetupEnvironment(),
        NODE_ENV: 'test',
        NODE_EXTRA_CA_CERTS: caCertificatePath
      },
      input: JSON.stringify({ databaseUrl, runtimeDatabaseUrl }),
      failureLabel: 'Reviewed canonical65 TEST setup',
      safeCanonicalSeedFailure: true
    }
  )
}

export const controlledSessionProgram = `
import { createRoleDatabaseRuntime } from '/app/api/dist/db/database.js';
import { createSsoIdentityRepository } from '/app/api/dist/auth/ssoIdentityRepository.js';
import { createPhase7SessionCookie } from '/app/api/dist/auth/phase7SessionCookie.js';
import { readFileSync } from 'node:fs';
const { suffix } = JSON.parse(readFileSync(0, 'utf8'));
const url = new URL(process.env.AUTH_GATEWAY_DATABASE_URL);
if (process.env.NODE_ENV !== 'production' || process.env.DEPLOYMENT_ENVIRONMENT !== 'TEST' ||
    !/^[a-f0-9]{12}$/.test(suffix) || !url.pathname.endsWith('_test') ||
    !/^phase7_[a-f0-9]{32}_test$/.test(url.searchParams.get('schema')))
  throw new Error('Controlled TEST session target is invalid.');
const gateway = createRoleDatabaseRuntime(url.toString(), 'nihongo_auth_gateway');
try {
  const session = await createSsoIdentityRepository(gateway.client).signIn({
    provider: 'google', accountId: 'phase11-' + suffix,
    email: 'phase11-' + suffix + '@example.test', name: 'Phase 11 smoke'
  }, { ipAddress: '127.0.0.1', userAgent: 'Phase11 controlled TEST fixture' });
  if (session.kind !== 'SESSION_CONFIRMED') throw new Error('Controlled TEST session was not confirmed.');
  const cookie = createPhase7SessionCookie({ token: session.token, secret: process.env.BETTER_AUTH_SECRET,
    isProduction: true, rememberMe: true, now: session.createdAt, expiresAt: session.expiresAt });
  process.stdout.write(JSON.stringify({ cookie, kind: 'controlled-test-session', provider: 'google' }));
} finally { await gateway.disconnect(); }
`

export const readSafeRuntimeFailureDiagnostics = (
  containerName,
  sensitiveValues,
  runCommand = run
) => {
  const result = runCommand('docker', ['logs', '--tail', '40', containerName], {
    allowFailure: true
  })
  if (result.status !== 0) return 'container logs unavailable'
  let output = `${result.stdout}\n${result.stderr}`
  for (const value of sensitiveValues) {
    if (typeof value === 'string' && value.length >= 8) {
      output = output.replaceAll(value, '[REDACTED]')
    }
  }
  output = output.trim().slice(-4_000)
  return output || 'container logs were empty'
}

const waitForRuntime = async (origin, containerName, sensitiveValues) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health/ready`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(1_000)
      })
      if (response.status === 200) return
    } catch {
      // The listener is not open yet.
    }
    const state = run(
      'docker',
      ['inspect', '--format', '{{.State.Running}}', containerName],
      { allowFailure: true }
    )
    if (state.status !== 0 || state.stdout.trim() !== 'true') {
      const diagnostics = readSafeRuntimeFailureDiagnostics(
        containerName,
        sensitiveValues
      )
      throw new Error(
        `Isolated production runtime exited before readiness.\n${diagnostics}`
      )
    }
    await wait(500)
  }
  throw new Error('Isolated production runtime did not become ready.')
}

export const readBoundedAuthResponse = async (response) => {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Stateful auth smoke response is too large.')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > 16_384) {
        await reader.cancel()
        throw new Error('Stateful auth smoke response is too large.')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}

export const readProductionSessionCookie = (response) => {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers)
  const values = getSetCookie
    ? getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  const sessionCookies = values.filter((value) =>
    /^(?:__Secure-)?nihongo\.session_token=/u.test(value)
  )
  if (
    sessionCookies.length !== 1 ||
    !sessionCookies[0].startsWith('__Secure-nihongo.session_token=')
  ) {
    throw new Error(
      'Stateful auth smoke returned an invalid production session cookie set.'
    )
  }

  const [cookiePair, ...attributes] = sessionCookies[0]
    .split(';')
    .map((part) => part.trim())
  const normalizedAttributes = attributes.map((attribute) =>
    attribute.toLowerCase()
  )
  if (
    !cookiePair ||
    cookiePair === '__Secure-nihongo.session_token=' ||
    JSON.stringify(normalizedAttributes.sort()) !==
      JSON.stringify([
        'httponly',
        'max-age=604800',
        'path=/',
        'samesite=lax',
        'secure'
      ])
  ) {
    throw new Error(
      'Stateful auth smoke returned invalid production session cookie attributes.'
    )
  }
  return cookiePair
}

export const validateStatefulPrincipal = (principal) => {
  assertExactKeys(principal, ['kind', 'user'], 'Stateful auth principal')
  if (principal.kind !== 'USER') {
    throw new Error('Stateful auth principal contract is invalid.')
  }
  assertExactKeys(
    principal.user,
    ['id', 'name', 'role', 'targetLevel'],
    'Stateful auth user'
  )
  if (
    typeof principal.user.id !== 'string' ||
    !uuidPattern.test(principal.user.id) ||
    principal.user.name !== 'Phase 11 smoke' ||
    principal.user.role !== 'USER' ||
    principal.user.targetLevel !== 'N5'
  ) {
    throw new Error('Stateful auth principal contract is invalid.')
  }
  return principal
}

export const validateLearnerQuestionSummary = (question, fixture) => {
  assertExactKeys(
    question,
    [
      'difficulty',
      'id',
      'level',
      'questionTextPreview',
      'questionType',
      'questionVersionId',
      'subject',
      'tags'
    ],
    'Learner compatibility question'
  )
  if (
    question.id !== fixture.questionId ||
    question.questionVersionId !== fixture.versionId ||
    question.level !== fixture.level ||
    question.subject !== fixture.subject ||
    question.questionType !== fixture.questionType ||
    question.difficulty !== fixture.difficulty ||
    question.questionTextPreview !== fixture.questionText ||
    !Array.isArray(question.tags) ||
    question.tags.length !== fixture.tags.length
  ) {
    throw new Error('Learner compatibility question contract is invalid.')
  }
  for (const tag of question.tags)
    assertExactKeys(tag, ['id', 'label'], 'Learner compatibility tag')
  const sortedTags = (tags) =>
    tags
      .toSorted((left, right) => left.id.localeCompare(right.id))
      .map(({ id, label }) => ({ id, label }))
  if (
    JSON.stringify(sortedTags(question.tags)) !==
    JSON.stringify(sortedTags(fixture.tags))
  ) {
    throw new Error('Learner compatibility question contract is invalid.')
  }
  return question
}

const canonicalIsoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export const validateLearnerBookmark = (bookmark, fixture) => {
  assertExactKeys(
    bookmark,
    ['availability', 'createdAt', 'question', 'questionId'],
    'Learner compatibility bookmark'
  )
  if (
    bookmark.questionId !== fixture.questionId ||
    bookmark.availability !== 'AVAILABLE' ||
    typeof bookmark.createdAt !== 'string' ||
    !canonicalIsoDateTimePattern.test(bookmark.createdAt) ||
    Number.isNaN(Date.parse(bookmark.createdAt)) ||
    new Date(bookmark.createdAt).toISOString() !== bookmark.createdAt
  ) {
    throw new Error('Learner compatibility bookmark contract is invalid.')
  }
  validateLearnerQuestionSummary(bookmark.question, fixture)
  return bookmark
}

const readExpectedJsonResponse = async (response, expectedStatus, label) => {
  if (response.status !== expectedStatus) {
    throw new Error(
      label + ' did not return status ' + String(expectedStatus) + '.'
    )
  }
  return parseUniqueKeyJson(await readBoundedAuthResponse(response))
}

export const runLearnerCompatibilityProbe = async ({
  origin,
  sessionCookie,
  fixture,
  fetchResponse = fetch
}) => {
  const questionResponse = await fetchResponse(
    origin +
      '/api/v1/questions?tag=' +
      encodeURIComponent(fixture.tagLabel) +
      '&page=1&pageSize=20',
    {
      headers: { Cookie: sessionCookie },
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    }
  )
  const questionList = await readExpectedJsonResponse(
    questionResponse,
    200,
    'Learner compatibility question list'
  )
  assertExactKeys(
    questionList,
    ['items', 'page', 'pageSize', 'total'],
    'Learner compatibility question page'
  )
  if (
    questionList.page !== 1 ||
    questionList.pageSize !== 20 ||
    questionList.total !== 1 ||
    !Array.isArray(questionList.items) ||
    questionList.items.length !== 1
  ) {
    throw new Error('Learner compatibility question page is invalid.')
  }
  validateLearnerQuestionSummary(questionList.items[0], fixture)

  const bookmarkCreateResponse = await fetchResponse(
    origin + '/api/v1/bookmarks/' + fixture.questionId,
    {
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        Origin: 'https://smoke.invalid'
      },
      method: 'PUT',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    }
  )
  validateLearnerBookmark(
    await readExpectedJsonResponse(
      bookmarkCreateResponse,
      201,
      'Learner compatibility bookmark creation'
    ),
    fixture
  )

  const bookmarkListResponse = await fetchResponse(
    origin + '/api/v1/bookmarks?page=1&pageSize=20',
    {
      headers: { Cookie: sessionCookie },
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    }
  )
  const bookmarkList = await readExpectedJsonResponse(
    bookmarkListResponse,
    200,
    'Learner compatibility bookmark list'
  )
  assertExactKeys(
    bookmarkList,
    ['items', 'page', 'pageSize', 'total'],
    'Learner compatibility bookmark page'
  )
  if (
    bookmarkList.page !== 1 ||
    bookmarkList.pageSize !== 20 ||
    bookmarkList.total !== 1 ||
    !Array.isArray(bookmarkList.items) ||
    bookmarkList.items.length !== 1
  ) {
    throw new Error('Learner compatibility bookmark page is invalid.')
  }
  validateLearnerBookmark(bookmarkList.items[0], fixture)

  return {
    bookmarkCreateStatus: bookmarkCreateResponse.status,
    bookmarkListStatus: bookmarkListResponse.status,
    bookmarkRows: bookmarkList.items.length,
    questionListStatus: questionResponse.status,
    questionRows: questionList.items.length
  }
}

export const runStatefulAuthCompatibilityProbe = async ({
  database,
  runtimeContainer,
  schemaName,
  origin,
  suffix,
  fixture,
  runCommand = run,
  fetchResponse = fetch
}) => {
  if (!/^[0-9a-f]{12}$/u.test(suffix) || !schemaPattern.test(schemaName)) {
    throw new Error('Controlled TEST fixture inputs are invalid.')
  }
  const session = parseUniqueKeyJson(
    runCommand(
      'docker',
      ['exec', '-i', runtimeContainer, 'node', '--input-type=module'],
      {
        input: controlledSessionProgram.replace(
          "readFileSync(0, 'utf8')",
          JSON.stringify(JSON.stringify({ suffix }))
        ),
        failureLabel: 'Controlled Google-linked TEST session preparation'
      }
    ).stdout
  )
  assertExactKeys(
    session,
    ['cookie', 'kind', 'provider'],
    'Controlled TEST session'
  )
  if (
    session.kind !== 'controlled-test-session' ||
    session.provider !== 'google'
  ) {
    throw new Error('Controlled TEST session classification is invalid.')
  }
  const sessionCookie = readProductionSessionCookie(
    new Response(null, { headers: { 'Set-Cookie': session.cookie } })
  )
  const result = runCommand(
    'docker',
    [
      'exec',
      '-i',
      database.containerName,
      'psql',
      '-X',
      '-q',
      '-A',
      '-t',
      '-U',
      database.databaseUser,
      '-d',
      database.databaseName,
      '-v',
      'ON_ERROR_STOP=1'
    ],
    {
      input: `SET search_path TO "${schemaName}";
        UPDATE "User" SET "targetLevel" = 'N5' WHERE "id" IN
          (SELECT "userId" FROM "Account" WHERE "providerId" = 'google' AND "accountId" = 'phase11-${suffix}');
        SELECT u."id" FROM "User" u JOIN "Account" a ON a."userId" = u."id"
        JOIN "Session" s ON s."userId" = u."id"
        JOIN "AuthSessionFamily" f ON f."userId" = u."id" AND f."id" = s."sessionFamilyId"
        WHERE a."providerId" = 'google' AND a."accountId" = 'phase11-${suffix}' AND a."password" IS NULL
          AND u."accountStatus" = 'ACTIVE' AND u."targetLevel" = 'N5' AND u."role" = 'USER'
          AND s."issuerProtocolVersion" = 'PHASE7_V1' AND s."authorizationState" = 'ACTIVE'
          AND s."authorityGeneration" = u."authorityGeneration" AND s."expiresAt" > clock_timestamp()
          AND f."status" = 'ACTIVE' AND (SELECT count(*) FROM "User") = 1
          AND (SELECT count(*) FROM "Account") = 1 AND (SELECT count(*) FROM "Session") = 1;`,
      failureLabel: 'Controlled TEST session persistence and profile'
    }
  ).stdout.trim()
  if (!uuidPattern.test(result))
    throw new Error('Controlled TEST Google/session persistence is incomplete.')
  const principalResponse = await fetchResponse(`${origin}/api/v1/me`, {
    headers: { Cookie: sessionCookie },
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000)
  })
  const principal = validateStatefulPrincipal(
    await readExpectedJsonResponse(
      principalResponse,
      200,
      'Stateful auth principal'
    )
  )
  if (principal.user.id !== result)
    throw new Error('Controlled TEST session actor does not match persistence.')
  return {
    learnerCompatibility: await runLearnerCompatibilityProbe({
      origin,
      sessionCookie,
      fixture,
      fetchResponse
    }),
    statefulAuth: {
      accountRows: 1,
      principalStatus: principalResponse.status,
      sessionRows: 1,
      userRows: 1,
      fixtureKind: 'controlled-test-session',
      provider: 'google',
      providerExchangeVerified: false
    }
  }
}

const readDockerResourcePresence = (type, name, runCommand) => {
  const argumentsList =
    type === 'network'
      ? ['network', 'ls', '--quiet', '--filter', `name=^${name}$`]
      : ['container', 'ls', '--all', '--quiet', '--filter', `name=^/${name}$`]
  const result = runCommand('docker', argumentsList, { allowFailure: true })
  if (result.status !== 0) return undefined
  return result.stdout.trim().length > 0
}

export const cleanupDockerResource = (type, name, runCommand = run) => {
  const present = readDockerResourcePresence(type, name, runCommand)
  if (present === undefined) return false
  if (!present) return true
  const command =
    type === 'network' ? ['network', 'rm', name] : ['rm', '-f', name]
  const removal = runCommand('docker', command, { allowFailure: true })
  if (removal.status !== 0) return false
  return readDockerResourcePresence(type, name, runCommand) === false
}

export const readRuntimeContainerImageId = (
  containerName,
  runCommand = run
) => {
  const imageId = runCommand('docker', [
    'container',
    'inspect',
    '--format',
    '{{.Image}}',
    containerName
  ]).stdout.trim()
  if (!imageIdPattern.test(imageId)) {
    throw new Error('Runtime container image identity is invalid.')
  }
  return imageId
}

export const assertExpectedRuntimeImageId = (
  actualImageId,
  expectedImageId
) => {
  if (!imageIdPattern.test(expectedImageId)) {
    throw new Error('Expected runtime image identity is invalid.')
  }
  if (actualImageId !== expectedImageId) {
    throw new Error('Runtime container image identity does not match evidence.')
  }
  return actualImageId
}

export const verifyPackagedAccountErasureCommand = (
  imageId,
  runCommand = run
) => {
  if (!imageIdPattern.test(imageId)) {
    throw new Error('Account erasure command image identity is invalid.')
  }
  const result = runCommand(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--entrypoint',
      'node',
      imageId,
      '/app/api/dist/auth/ssoAccountErasureCommand.js'
    ],
    { allowFailure: true }
  )
  if (
    result.status !== 1 ||
    result.stdout !== '' ||
    result.stderr !== '{"event":"auth.account_erasure.failed"}\n'
  ) {
    throw new Error(
      'Packaged account erasure command did not fail closed without configuration.'
    )
  }
}

export const combineRuntimeSmokeErrors = (operationError, cleanupError) => {
  if (operationError && cleanupError) {
    const operationMessage =
      operationError instanceof Error
        ? operationError.message
        : 'unknown runtime smoke failure'
    return new AggregateError(
      [operationError, cleanupError],
      `Runtime smoke failed: ${operationMessage}; ${cleanupError.message}`
    )
  }
  return cleanupError ?? operationError
}

export const verifyPortableRuntimeSmokeEvidence = (evidence) => {
  assertExactKeys(
    evidence,
    [
      'databaseAccess',
      'evidenceClassification',
      'imageId',
      'learnerCompatibility',
      'migrationCount',
      'profile',
      'releaseId',
      'runtimeSecurity',
      'schemaVersion',
      'shutdown',
      'smoke',
      'statefulAuth'
    ],
    'Runtime smoke evidence'
  )
  if (
    evidence.schemaVersion !== 3 ||
    evidence.evidenceClassification !== 'TEST' ||
    evidence.profile !== 'isolated-production-mode' ||
    evidence.migrationCount !== currentMigrationCount ||
    !imageIdPattern.test(evidence.imageId)
  ) {
    throw new Error('Runtime smoke evidence identity is invalid.')
  }
  const releaseId = assertReleaseId(evidence.releaseId)
  assertExactKeys(
    evidence.databaseAccess,
    [
      'migrationAndRuntimeIdentitiesSeparated',
      'migrationLedger',
      'runtimeElevatedAttributes'
    ],
    'Runtime database access evidence'
  )
  if (
    evidence.databaseAccess.migrationAndRuntimeIdentitiesSeparated !== true ||
    evidence.databaseAccess.migrationLedger !== 'read-only' ||
    evidence.databaseAccess.runtimeElevatedAttributes !== false
  ) {
    throw new Error('Runtime database access evidence is invalid.')
  }
  assertExactKeys(
    evidence.runtimeSecurity,
    ['capabilities', 'filesystem', 'noNewPrivileges', 'temporaryDirectory'],
    'Runtime security evidence'
  )
  if (
    evidence.runtimeSecurity.capabilities !== 'none' ||
    evidence.runtimeSecurity.filesystem !== 'read-only' ||
    evidence.runtimeSecurity.noNewPrivileges !== true ||
    evidence.runtimeSecurity.temporaryDirectory !== 'tmpfs'
  ) {
    throw new Error('Runtime security evidence is invalid.')
  }
  assertExactKeys(
    evidence.statefulAuth,
    [
      'accountRows',
      'principalStatus',
      'sessionRows',
      'fixtureKind',
      'provider',
      'providerExchangeVerified',
      'userRows'
    ],
    'Runtime stateful auth evidence'
  )
  if (
    evidence.statefulAuth.accountRows !== 1 ||
    evidence.statefulAuth.principalStatus !== 200 ||
    evidence.statefulAuth.sessionRows !== 1 ||
    evidence.statefulAuth.fixtureKind !== 'controlled-test-session' ||
    evidence.statefulAuth.provider !== 'google' ||
    evidence.statefulAuth.providerExchangeVerified !== false ||
    evidence.statefulAuth.userRows !== 1
  ) {
    throw new Error('Runtime stateful auth evidence is invalid.')
  }
  assertExactKeys(
    evidence.learnerCompatibility,
    [
      'bookmarkCreateStatus',
      'bookmarkListStatus',
      'bookmarkRows',
      'questionListStatus',
      'questionRows'
    ],
    'Runtime learner compatibility evidence'
  )
  if (
    evidence.learnerCompatibility.bookmarkCreateStatus !== 201 ||
    evidence.learnerCompatibility.bookmarkListStatus !== 200 ||
    evidence.learnerCompatibility.bookmarkRows !== 1 ||
    evidence.learnerCompatibility.questionListStatus !== 200 ||
    evidence.learnerCompatibility.questionRows !== 1
  ) {
    throw new Error('Runtime learner compatibility evidence is invalid.')
  }
  assertExactKeys(
    evidence.shutdown,
    ['exitCode', 'signal'],
    'Shutdown evidence'
  )
  if (
    evidence.shutdown.exitCode !== 0 ||
    evidence.shutdown.signal !== 'SIGTERM'
  ) {
    throw new Error('Runtime shutdown evidence is invalid.')
  }
  assertExactKeys(
    evidence.smoke,
    [
      'checks',
      'environment',
      'releaseId',
      'schemaVersion',
      'targetFingerprintSha256'
    ],
    'Runtime HTTP smoke evidence'
  )
  if (
    evidence.smoke.schemaVersion !== 1 ||
    evidence.smoke.environment !== 'TEST' ||
    evidence.smoke.releaseId !== releaseId ||
    !sha256Pattern.test(evidence.smoke.targetFingerprintSha256) ||
    !Array.isArray(evidence.smoke.checks) ||
    evidence.smoke.checks.length < 6
  ) {
    throw new Error('Runtime HTTP smoke evidence is invalid.')
  }
  const paths = evidence.smoke.checks.map((check, index) => {
    assertExactKeys(
      check,
      ['durationMs', 'path', 'status'],
      'Runtime HTTP check'
    )
    if (
      !Number.isInteger(check.durationMs) ||
      check.durationMs < 0 ||
      check.durationMs > 30_000 ||
      typeof check.path !== 'string' ||
      !Number.isInteger(check.status)
    ) {
      throw new Error('Runtime HTTP check is invalid.')
    }
    const isLast = index === evidence.smoke.checks.length - 1
    if (check.status !== (isLast ? 404 : 200)) {
      throw new Error('Runtime HTTP check status is invalid.')
    }
    return check.path
  })
  if (
    JSON.stringify(paths.slice(0, 4)) !==
      JSON.stringify(['/health/live', '/health/ready', '/', '/login']) ||
    paths.at(-1) !== '/mockServiceWorker.js'
  ) {
    throw new Error('Runtime HTTP check sequence is invalid.')
  }
  const assetPaths = paths.slice(4, -1)
  if (
    assetPaths.length === 0 ||
    assetPaths.some(
      (path, index) =>
        !isCanonicalRuntimeAssetPath(path) ||
        (index > 0 && assetPaths[index - 1] >= path)
    )
  ) {
    throw new Error('Runtime HTTP asset checks are invalid.')
  }
  return evidence
}

export const runPortableRuntimeSmoke = async ({
  expectedImageId,
  image,
  output,
  releaseId
}) => {
  const exactReleaseId = assertReleaseId(releaseId)
  if (!imageIdPattern.test(expectedImageId)) {
    throw new Error('Expected runtime image identity is invalid.')
  }
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const networkName = `nihongo-p11-${suffix}`
  const databaseContainer = `nihongo-p11-db-${suffix}`
  const runtimeContainer = `nihongo-p11-app-${suffix}`
  const databaseName = 'nihongo_runtime_smoke_test'
  const databaseAdminUser = 'nihongo_runtime_smoke_migration'
  const databaseAdminPassword = randomBytes(24).toString('hex')
  const runtimePassword = randomBytes(24).toString('hex')
  const gatewayPassword = randomBytes(24).toString('hex')
  const migrationPassword = randomBytes(24).toString('hex')
  const schemaName = `phase7_${randomUUID().replaceAll('-', '')}_test`
  const migrationNames = selectCurrentMigrationNames(
    resolve(repositoryRoot, 'apps/api/prisma/migrations')
  )
  const fixture = readCanonicalLearnerFixture()
  const database = {
    containerName: databaseContainer,
    databaseName,
    databaseUser: databaseAdminUser,
    password: databaseAdminPassword
  }
  const migrationsDirectory = resolve(
    repositoryRoot,
    'apps/api/prisma/migrations'
  )
  const certificateDirectory = mkdtempSync(join(tmpdir(), 'nihongo-p11-cert-'))
  let cleanupError
  let operationError

  try {
    chmodSync(certificateDirectory, 0o711)
    run(
      'openssl',
      createPostgresCertificateArguments(
        databaseContainer,
        certificateDirectory
      )
    )
    chmodSync(join(certificateDirectory, 'server.key'), 0o600)
    run('docker', ['network', 'create', networkName])
    run('docker', [
      'run',
      '--rm',
      '--user',
      '0',
      '--volume',
      `${certificateDirectory}:/certs`,
      '--entrypoint',
      'sh',
      postgresImage,
      '-c',
      'chown postgres:postgres /certs/server.key /certs/server.crt && chmod 600 /certs/server.key && chmod 644 /certs/server.crt'
    ])
    run('docker', [
      'run',
      '--detach',
      '--name',
      databaseContainer,
      '--network',
      networkName,
      '--publish',
      '127.0.0.1::5432',
      '--env',
      `POSTGRES_DB=${databaseName}`,
      '--env',
      `POSTGRES_USER=${databaseAdminUser}`,
      '--env',
      `POSTGRES_PASSWORD=${databaseAdminPassword}`,
      '--volume',
      `${certificateDirectory}:/certs:ro`,
      postgresImage,
      '-c',
      'ssl=on',
      '-c',
      'ssl_cert_file=/certs/server.crt',
      '-c',
      'ssl_key_file=/certs/server.key'
    ])
    await waitForPostgres(databaseContainer, databaseAdminUser, databaseName)
    provisionRuntimeIdentity(database, schemaName, {
      [migrationLogin]: migrationPassword,
      [applicationLogin]: runtimePassword,
      [gatewayLogin]: gatewayPassword
    })
    const migrationDatabase = {
      ...database,
      databaseUser: migrationLogin,
      password: migrationPassword,
      schemaName
    }
    applyCurrentMigrations(
      migrationDatabase,
      migrationsDirectory,
      migrationNames.slice(0, 37),
      true
    )
    databaseCommand(
      migrationDatabase,
      `SELECT "phase7_register_database_capability"(
      current_database(), inet_server_addr(), inet_server_port(), 'TEST');
      SELECT "phase7_activate_v1_issuer"('TEST');`
    )
    const databasePortOutput = run('docker', [
      'port',
      databaseContainer,
      '5432/tcp'
    ]).stdout.trim()
    const databasePort = /^127\.0\.0\.1:(\d+)$/u.exec(databasePortOutput)?.[1]
    if (!databasePort)
      throw new Error('Unable to resolve isolated TEST database port.')
    seedLearnerCompatibilityFixture(
      `postgresql://${migrationLogin}:${migrationPassword}@127.0.0.1:${databasePort}/${databaseName}?schema=${schemaName}&sslmode=verify-full`,
      `postgresql://${applicationLogin}:${runtimePassword}@127.0.0.1:${databasePort}/${databaseName}?schema=${schemaName}&sslmode=verify-full`,
      join(certificateDirectory, 'server.crt')
    )
    applyCurrentMigrations(
      migrationDatabase,
      migrationsDirectory,
      migrationNames.slice(37)
    )
    const migrationCount = migrationNames.length

    const runtimeEnvironment = createRuntimeEnvironment({
      databaseHost: databaseContainer,
      databaseName,
      databasePassword: runtimePassword,
      gatewayPassword,
      schemaName,
      releaseId: exactReleaseId
    })
    const runtimeSensitiveValues = [
      runtimeEnvironment.AUTH_GATEWAY_DATABASE_URL,
      gatewayPassword,
      migrationPassword,
      runtimeEnvironment.BETTER_AUTH_SECRET,
      runtimeEnvironment.DATABASE_URL,
      runtimeEnvironment.GUEST_COOKIE_SECRET,
      runtimePassword
    ]
    const environmentArguments = Object.entries(runtimeEnvironment).flatMap(
      ([name, value]) => ['--env', `${name}=${value}`]
    )
    run('docker', [
      'run',
      '--detach',
      '--name',
      runtimeContainer,
      '--network',
      networkName,
      '--publish',
      '127.0.0.1::3001',
      ...createRuntimePublicCertificateArguments(certificateDirectory),
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      ...environmentArguments,
      image
    ])
    const imageId = assertExpectedRuntimeImageId(
      readRuntimeContainerImageId(runtimeContainer),
      expectedImageId
    )
    verifyPackagedAccountErasureCommand(imageId)
    const portOutput = run('docker', [
      'port',
      runtimeContainer,
      '3001/tcp'
    ]).stdout.trim()
    const port = /127\.0\.0\.1:(\d+)$/u.exec(portOutput)?.[1]
    if (!port) throw new Error('Unable to resolve isolated runtime port.')
    const origin = `http://127.0.0.1:${port}`
    await waitForRuntime(origin, runtimeContainer, runtimeSensitiveValues)
    const compatibility = await runStatefulAuthCompatibilityProbe({
      database,
      runtimeContainer,
      schemaName,
      origin,
      fixture,
      suffix
    })
    const smoke = await runPostDeploySmoke({
      allowLoopbackHttp: true,
      environment: 'TEST',
      origin,
      releaseId: exactReleaseId
    })

    run('docker', [
      'stop',
      '--signal',
      'SIGTERM',
      '--time',
      '10',
      runtimeContainer
    ])
    const exitCode = Number(
      run('docker', [
        'inspect',
        '--format',
        '{{.State.ExitCode}}',
        runtimeContainer
      ]).stdout.trim()
    )
    if (exitCode !== 0) {
      throw new Error('Isolated runtime did not stop cleanly after SIGTERM.')
    }
    const evidence = {
      schemaVersion: 3,
      evidenceClassification: 'TEST',
      profile: 'isolated-production-mode',
      releaseId: exactReleaseId,
      imageId,
      migrationCount,
      databaseAccess: {
        migrationLedger: 'read-only',
        migrationAndRuntimeIdentitiesSeparated: true,
        runtimeElevatedAttributes: false
      },
      runtimeSecurity: {
        capabilities: 'none',
        filesystem: 'read-only',
        noNewPrivileges: true,
        temporaryDirectory: 'tmpfs'
      },
      learnerCompatibility: compatibility.learnerCompatibility,
      statefulAuth: compatibility.statefulAuth,
      smoke,
      shutdown: {
        exitCode,
        signal: 'SIGTERM'
      }
    }
    verifyPortableRuntimeSmokeEvidence(evidence)
    writeManifestAtomically(resolve(output), evidence)
  } catch (error) {
    operationError = error
  } finally {
    const cleanupFailures = []
    for (const [label, type, name] of [
      ['runtime-container', 'container', runtimeContainer],
      ['database-container', 'container', databaseContainer],
      ['network', 'network', networkName]
    ]) {
      if (!cleanupDockerResource(type, name)) {
        cleanupFailures.push(`${label}:${name}`)
      }
    }
    try {
      rmSync(certificateDirectory, { force: true, recursive: true })
    } catch {
      cleanupFailures.push('certificate-directory')
    }
    if (cleanupFailures.length > 0) {
      cleanupError = new Error(
        `Isolated runtime smoke cleanup did not complete: ${cleanupFailures.join(', ')}.`
      )
    }
  }
  const finalError = combineRuntimeSmokeErrors(operationError, cleanupError)
  if (finalError) throw finalError
}

export const runPortableRuntimeSmokeCli = async (argumentsList) => {
  const argumentsMap = parseArguments(argumentsList)
  const mode = argumentsMap.get('--mode') ?? 'create'
  if (mode === 'verify') {
    const evidence = verifyPortableRuntimeSmokeEvidence(
      readBoundedUniqueKeyJsonFile(
        resolve(requiredArgument(argumentsMap, '--input')),
        { label: 'Runtime smoke evidence' }
      )
    )
    assertExpectedRuntimeImageId(
      evidence.imageId,
      requiredArgument(argumentsMap, '--expected-image-id')
    )
    return
  }
  if (mode !== 'create') {
    throw new Error(`Unsupported runtime smoke mode: ${mode}`)
  }
  await runPortableRuntimeSmoke({
    expectedImageId: requiredArgument(argumentsMap, '--expected-image-id'),
    image: requiredArgument(argumentsMap, '--image'),
    output: requiredArgument(argumentsMap, '--output'),
    releaseId: requiredArgument(argumentsMap, '--release-id')
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runPortableRuntimeSmokeCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Portable runtime smoke failed.'}\n`
    )
    process.exitCode = 1
  }
}
