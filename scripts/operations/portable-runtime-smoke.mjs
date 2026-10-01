#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertReleaseId } from './release-contract.mjs'
import { writeManifestAtomically } from './release-manifest.mjs'
import { runPostDeploySmoke } from './post-deploy-smoke.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const postgresImage =
  'postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'
const firstPhase7Migration = '20260827100000_phase7_admin_cms_enums'
const prePhase7MigrationCount = 27
const sha256Pattern = /^[0-9a-f]{64}$/u
const imageIdPattern = /^sha256:[0-9a-f]{64}$/u

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
    throw new Error(
      `${command} failed with exit code ${result.status ?? 'unknown'}.`
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

export const selectPrePhase7MigrationNames = (migrationsDirectory) => {
  const names = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (
    names[prePhase7MigrationCount] !== firstPhase7Migration ||
    names.length <= prePhase7MigrationCount
  ) {
    throw new Error('Repository pre-Phase-7 migration boundary is invalid.')
  }
  return names.slice(0, prePhase7MigrationCount)
}

export const createRuntimeEnvironment = ({
  databaseHost,
  databaseName,
  databasePassword,
  databaseUser,
  releaseId
}) => {
  const secret = randomBytes(32).toString('hex')
  return {
    ADMIN_CMS_MODE: 'disabled',
    AUTH_EMAIL_DELIVERY_MODE: 'webhook',
    AUTH_EMAIL_FROM: 'auth@smoke.invalid',
    AUTH_EMAIL_WEBHOOK_SECRET: randomBytes(32).toString('hex'),
    AUTH_EMAIL_WEBHOOK_URL: 'https://mail.smoke.invalid/auth-events',
    AUTH_TRUSTED_PROXY_CIDRS: '172.16.0.0/12',
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: 'https://smoke.invalid',
    DATABASE_URL: `postgresql://${databaseUser}:${databasePassword}@${databaseHost}:5432/${databaseName}?sslmode=require&uselibpqcompat=true`,
    GUEST_COOKIE_SECRET: randomBytes(32).toString('hex'),
    HOST: '0.0.0.0',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'production',
    PORT: '3001',
    PRACTICE_CONTRACT_RUNTIME: 'v1-v2',
    RELEASE_ID: assertReleaseId(releaseId),
    TRUSTED_ORIGINS: 'https://smoke.invalid'
  }
}

const waitForPostgres = async (containerName, databaseUser, databaseName) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = run(
      'docker',
      [
        'exec',
        containerName,
        'pg_isready',
        '-U',
        databaseUser,
        '-d',
        databaseName
      ],
      { allowFailure: true }
    )
    if (result.status === 0) return
    await wait(500)
  }
  throw new Error('Isolated PostgreSQL did not become ready.')
}

const applyPrePhase7Migrations = ({
  containerName,
  databaseName,
  databaseUser,
  migrationsDirectory
}) => {
  const migrationNames = selectPrePhase7MigrationNames(migrationsDirectory)
  const ledgerSql = `
CREATE TABLE "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
`
  run(
    'docker',
    [
      'exec',
      '-i',
      containerName,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      databaseUser,
      '-d',
      databaseName
    ],
    { input: ledgerSql }
  )

  for (const name of migrationNames) {
    const sql = readFileSync(join(migrationsDirectory, name, 'migration.sql'))
    run(
      'docker',
      [
        'exec',
        '-i',
        containerName,
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        databaseUser,
        '-d',
        databaseName
      ],
      { input: sql }
    )
    const checksum = createHash('sha256').update(sql).digest('hex')
    const ledgerEntry = `
INSERT INTO "_prisma_migrations" (
  "id", "checksum", "finished_at", "migration_name", "logs",
  "rolled_back_at", "started_at", "applied_steps_count"
) VALUES (
  '${randomUUID()}', '${checksum}', now(), '${name}', NULL, NULL, now(), 1
);
`
    run(
      'docker',
      [
        'exec',
        '-i',
        containerName,
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        databaseUser,
        '-d',
        databaseName
      ],
      { input: ledgerEntry }
    )
  }
  return migrationNames.length
}

const provisionRuntimeIdentity = ({
  containerName,
  databaseAdminUser,
  databaseName,
  runtimePassword,
  runtimeUser
}) => {
  const sql = `
CREATE ROLE "${runtimeUser}"
  LOGIN PASSWORD '${runtimePassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE "${databaseName}" TO "${runtimeUser}";
GRANT USAGE ON SCHEMA public TO "${runtimeUser}";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeUser}";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "${runtimeUser}";
REVOKE INSERT, UPDATE, DELETE ON TABLE public."_prisma_migrations" FROM "${runtimeUser}";
`
  run(
    'docker',
    [
      'exec',
      '-i',
      containerName,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      databaseAdminUser,
      '-d',
      databaseName
    ],
    { input: sql }
  )
  const attributes = run('docker', [
    'exec',
    containerName,
    'psql',
    '-A',
    '-t',
    '-U',
    databaseAdminUser,
    '-d',
    databaseName,
    '-c',
    `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = '${runtimeUser}'`
  ]).stdout.trim()
  if (attributes !== 'f|f|f|f|f') {
    throw new Error('Isolated runtime database identity is over-privileged.')
  }
  const ledgerPrivileges = run('docker', [
    'exec',
    containerName,
    'psql',
    '-A',
    '-t',
    '-U',
    databaseAdminUser,
    '-d',
    databaseName,
    '-c',
    `SELECT has_table_privilege('${runtimeUser}', 'public."_prisma_migrations"', 'SELECT'), has_table_privilege('${runtimeUser}', 'public."_prisma_migrations"', 'INSERT'), has_table_privilege('${runtimeUser}', 'public."_prisma_migrations"', 'UPDATE'), has_table_privilege('${runtimeUser}', 'public."_prisma_migrations"', 'DELETE')`
  ]).stdout.trim()
  if (ledgerPrivileges !== 't|f|f|f') {
    throw new Error('Isolated runtime migration ledger privileges are invalid.')
  }
}

const waitForRuntime = async (origin, containerName) => {
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
      throw new Error('Isolated production runtime exited before readiness.')
    }
    await wait(500)
  }
  throw new Error('Isolated production runtime did not become ready.')
}

const cleanupDockerResource = (type, name) => {
  const inspect = run('docker', [type, 'inspect', name], { allowFailure: true })
  if (inspect.status !== 0) return true
  const command =
    type === 'network' ? ['network', 'rm', name] : ['rm', '-f', name]
  const removal = run('docker', command, { allowFailure: true })
  if (removal.status !== 0) return false
  return (
    run('docker', [type, 'inspect', name], { allowFailure: true }).status !== 0
  )
}

export const verifyPortableRuntimeSmokeEvidence = (evidence) => {
  assertExactKeys(
    evidence,
    [
      'databaseAccess',
      'evidenceClassification',
      'imageId',
      'migrationCount',
      'profile',
      'releaseId',
      'runtimeSecurity',
      'schemaVersion',
      'shutdown',
      'smoke'
    ],
    'Runtime smoke evidence'
  )
  if (
    evidence.schemaVersion !== 1 ||
    evidence.evidenceClassification !== 'TEST' ||
    evidence.profile !== 'isolated-production-mode' ||
    evidence.migrationCount !== prePhase7MigrationCount ||
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
        !/^\/assets\/[A-Za-z0-9._~/-]+$/u.test(path) ||
        (index > 0 && assetPaths[index - 1] >= path)
    )
  ) {
    throw new Error('Runtime HTTP asset checks are invalid.')
  }
  return evidence
}

export const runPortableRuntimeSmoke = async ({ image, output, releaseId }) => {
  const exactReleaseId = assertReleaseId(releaseId)
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const networkName = `nihongo-p11-${suffix}`
  const databaseContainer = `nihongo-p11-db-${suffix}`
  const runtimeContainer = `nihongo-p11-app-${suffix}`
  const certificateDirectory = mkdtempSync(join(tmpdir(), 'nihongo-p11-cert-'))
  const databaseName = 'nihongo_runtime_smoke_test'
  const databaseAdminUser = 'nihongo_runtime_smoke_migration'
  const databaseAdminPassword = randomBytes(24).toString('hex')
  const runtimeUser = 'nihongo_runtime_smoke_app'
  const runtimePassword = randomBytes(24).toString('hex')
  const migrationsDirectory = resolve(
    repositoryRoot,
    'apps/api/prisma/migrations'
  )
  let cleanupError
  let operationError

  try {
    chmodSync(certificateDirectory, 0o711)
    run('openssl', [
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
      'subjectAltName=DNS:postgres',
      '-keyout',
      join(certificateDirectory, 'server.key'),
      '-out',
      join(certificateDirectory, 'server.crt')
    ])
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
    const migrationCount = applyPrePhase7Migrations({
      containerName: databaseContainer,
      databaseName,
      databaseUser: databaseAdminUser,
      migrationsDirectory
    })
    provisionRuntimeIdentity({
      containerName: databaseContainer,
      databaseAdminUser,
      databaseName,
      runtimePassword,
      runtimeUser
    })

    const runtimeEnvironment = createRuntimeEnvironment({
      databaseHost: databaseContainer,
      databaseName,
      databasePassword: runtimePassword,
      databaseUser: runtimeUser,
      releaseId: exactReleaseId
    })
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
    const portOutput = run('docker', [
      'port',
      runtimeContainer,
      '3001/tcp'
    ]).stdout.trim()
    const port = /127\.0\.0\.1:(\d+)$/u.exec(portOutput)?.[1]
    if (!port) throw new Error('Unable to resolve isolated runtime port.')
    const origin = `http://127.0.0.1:${port}`
    await waitForRuntime(origin, runtimeContainer)
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
    const imageId = run('docker', [
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      image
    ]).stdout.trim()

    const evidence = {
      schemaVersion: 1,
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
    for (const [type, name] of [
      ['container', runtimeContainer],
      ['container', databaseContainer],
      ['network', networkName]
    ]) {
      if (!cleanupDockerResource(type, name)) cleanupFailures.push(type)
    }
    try {
      rmSync(certificateDirectory, { force: true, recursive: true })
    } catch {
      cleanupFailures.push('certificate-directory')
    }
    if (cleanupFailures.length > 0) {
      cleanupError = new Error(
        'Isolated runtime smoke cleanup did not complete.'
      )
    }
  }
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      'Runtime smoke and cleanup failed.'
    )
  }
  if (cleanupError) throw cleanupError
  if (operationError) throw operationError
}

export const runPortableRuntimeSmokeCli = async (argumentsList) => {
  const argumentsMap = parseArguments(argumentsList)
  const mode = argumentsMap.get('--mode') ?? 'create'
  if (mode === 'verify') {
    verifyPortableRuntimeSmokeEvidence(
      JSON.parse(
        readFileSync(resolve(requiredArgument(argumentsMap, '--input')), 'utf8')
      )
    )
    return
  }
  if (mode !== 'create') {
    throw new Error(`Unsupported runtime smoke mode: ${mode}`)
  }
  await runPortableRuntimeSmoke({
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
