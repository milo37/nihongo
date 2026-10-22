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
const firstPhase7Migration = '20260827100000_phase7_admin_cms_enums'
const prePhase7MigrationCount = 27
const sha256Pattern = /^[0-9a-f]{64}$/u
const imageIdPattern = /^sha256:[0-9a-f]{64}$/u
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const learnerCompatibilityFixture = Object.freeze({
  questionId: '00000000-0000-4000-8000-000000000101',
  questionText: '「朝」の読み方を選んでください。',
  tagId: '00000000-0000-4000-8000-000000000120',
  tagLabel: 'phase11-smoke-tag',
  versionId: '00000000-0000-4000-8000-000000000102'
})

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
    const stderrTail = options.includeStderr
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
    DEPLOYMENT_ENVIRONMENT: 'TEST',
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
    {
      failureLabel: 'Prisma migration ledger initialization',
      includeStderr: true,
      input: ledgerSql
    }
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
      {
        failureLabel: `Pre-Phase-7 migration ${name}`,
        includeStderr: true,
        input: sql
      }
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
      {
        failureLabel: `Prisma migration ledger entry ${name}`,
        includeStderr: true,
        input: ledgerEntry
      }
    )
  }
  return migrationNames.length
}

const seedLearnerCompatibilityFixture = ({
  containerName,
  databaseAdminUser,
  databaseName
}) => {
  const { questionId, questionText, tagId, tagLabel, versionId } =
    learnerCompatibilityFixture
  const sql = [
    'BEGIN;',
    'INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt")',
    "VALUES ('" +
      tagId +
      "', '" +
      tagLabel +
      "', '" +
      tagLabel +
      "', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
    'INSERT INTO "Question" ("id", "lifecycleStatus", "currentPublishedVersionId", "createdByUserId", "createdByLabelSnapshot", "createdAt", "updatedAt")',
    "VALUES ('" +
      questionId +
      "', 'ACTIVE', NULL, NULL, 'SYSTEM_SEED', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
    'INSERT INTO "QuestionVersion" ("id", "questionId", "versionNumber", "status", "level", "subject", "questionType", "passage", "questionText", "correctOptionId", "explanationKo", "explanationJa", "difficulty", "sourceType", "rowVersion", "createdByUserId", "createdByLabelSnapshot", "createdAt", "updatedAt")',
    "VALUES ('" +
      versionId +
      "', '" +
      questionId +
      "', 1, 'DRAFT', 'N5', 'VOCABULARY', 'KANJI_READING', NULL, '" +
      questionText +
      "', NULL, '「朝」는 「あさ」라고 읽습니다.', NULL, 'EASY', 'ORIGINAL', 1, NULL, 'SYSTEM_SEED', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
    'INSERT INTO "QuestionOption" ("id", "questionVersionId", "label", "text", "ordinal")',
    "VALUES ('00000000-0000-4000-8000-000000000111', '" +
      versionId +
      "', '1', 'あさ', 1),",
    "('00000000-0000-4000-8000-000000000112', '" +
      versionId +
      "', '2', 'ひる', 2),",
    "('00000000-0000-4000-8000-000000000113', '" +
      versionId +
      "', '3', 'よる', 3),",
    "('00000000-0000-4000-8000-000000000114', '" +
      versionId +
      "', '4', 'ゆう', 4);",
    'INSERT INTO "QuestionVersionTag" ("id", "questionVersionId", "tagId", "labelSnapshot")',
    "VALUES ('00000000-0000-4000-8000-000000000121', '" +
      versionId +
      "', '" +
      tagId +
      "', '" +
      tagLabel +
      "');",
    'UPDATE "QuestionVersion"',
    'SET "correctOptionId" = \'00000000-0000-4000-8000-000000000111\', "status" = \'PUBLISHED\', "publishedAt" = \'2026-01-01T00:00:00.000Z\', "updatedAt" = \'2026-01-01T00:00:00.000Z\'',
    'WHERE "id" = \'' + versionId + "';",
    'UPDATE "Question"',
    'SET "currentPublishedVersionId" = \'' +
      versionId +
      "', \"updatedAt\" = '2026-01-01T00:00:00.000Z'",
    'WHERE "id" = \'' + questionId + "';",
    'COMMIT;'
  ].join('\n')
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
    {
      failureLabel: 'Learner compatibility fixture seed',
      includeStderr: true,
      input: sql
    }
  )
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
    { failureLabel: 'Runtime database identity provisioning', input: sql }
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

const expectCookieOnlySuccess = async (response, label) => {
  if (response.status !== 200) {
    throw new Error(`${label} did not succeed.`)
  }
  const body = parseUniqueKeyJson(await readBoundedAuthResponse(response))
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    body.success !== true
  ) {
    throw new Error(`${label} returned an invalid contract.`)
  }
}

const postAuth = async (origin, path, body) =>
  await fetch(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://smoke.invalid'
    },
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000)
  })

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

export const validateLearnerQuestionSummary = (question) => {
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
    question.id !== learnerCompatibilityFixture.questionId ||
    question.questionVersionId !== learnerCompatibilityFixture.versionId ||
    question.level !== 'N5' ||
    question.subject !== 'VOCABULARY' ||
    question.questionType !== 'KANJI_READING' ||
    question.difficulty !== 'EASY' ||
    question.questionTextPreview !== learnerCompatibilityFixture.questionText ||
    !Array.isArray(question.tags) ||
    question.tags.length !== 1
  ) {
    throw new Error('Learner compatibility question contract is invalid.')
  }
  const tag = question.tags[0]
  assertExactKeys(tag, ['id', 'label'], 'Learner compatibility tag')
  if (
    tag.id !== learnerCompatibilityFixture.tagId ||
    tag.label !== learnerCompatibilityFixture.tagLabel
  ) {
    throw new Error('Learner compatibility question contract is invalid.')
  }
  return question
}

const canonicalIsoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export const validateLearnerBookmark = (bookmark) => {
  assertExactKeys(
    bookmark,
    ['availability', 'createdAt', 'question', 'questionId'],
    'Learner compatibility bookmark'
  )
  if (
    bookmark.questionId !== learnerCompatibilityFixture.questionId ||
    bookmark.availability !== 'AVAILABLE' ||
    typeof bookmark.createdAt !== 'string' ||
    !canonicalIsoDateTimePattern.test(bookmark.createdAt) ||
    Number.isNaN(Date.parse(bookmark.createdAt)) ||
    new Date(bookmark.createdAt).toISOString() !== bookmark.createdAt
  ) {
    throw new Error('Learner compatibility bookmark contract is invalid.')
  }
  validateLearnerQuestionSummary(bookmark.question)
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

const runLearnerCompatibilityProbe = async ({ origin, sessionCookie }) => {
  const questionResponse = await fetch(
    origin +
      '/api/v1/questions?tag=' +
      learnerCompatibilityFixture.tagLabel +
      '&page=1&pageSize=20',
    {
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
  validateLearnerQuestionSummary(questionList.items[0])

  const bookmarkCreateResponse = await fetch(
    origin + '/api/v1/bookmarks/' + learnerCompatibilityFixture.questionId,
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
    )
  )

  const bookmarkListResponse = await fetch(
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
  validateLearnerBookmark(bookmarkList.items[0])

  return {
    bookmarkCreateStatus: bookmarkCreateResponse.status,
    bookmarkListStatus: bookmarkListResponse.status,
    bookmarkRows: bookmarkList.items.length,
    questionListStatus: questionResponse.status,
    questionRows: questionList.items.length
  }
}

export const runStatefulAuthCompatibilityProbe = async ({
  containerName,
  databaseAdminUser,
  databaseName,
  origin,
  suffix
}) => {
  if (!/^[0-9a-f]{12}$/u.test(suffix)) {
    throw new Error('Stateful auth smoke suffix is invalid.')
  }
  const email = `phase11-${suffix}@example.test`
  const password = `Phase11-${suffix}-password!`
  const signUpResponse = await postAuth(origin, '/api/auth/sign-up/email', {
    email,
    name: 'Phase 11 smoke',
    password,
    targetLevel: 'N5'
  })
  await expectCookieOnlySuccess(signUpResponse, 'Stateful auth sign-up')

  const updateResult = run('docker', [
    'exec',
    containerName,
    'psql',
    '-U',
    databaseAdminUser,
    '-d',
    databaseName,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `UPDATE "User" SET "emailVerified" = true WHERE email = '${email}'`
  ]).stdout
  if (updateResult.trim() !== 'UPDATE 1') {
    throw new Error('Stateful auth smoke could not verify its disposable user.')
  }

  const signInResponse = await postAuth(origin, '/api/auth/sign-in/email', {
    email,
    password
  })
  const sessionCookie = readProductionSessionCookie(signInResponse)
  await expectCookieOnlySuccess(signInResponse, 'Stateful auth sign-in')

  const principalResponse = await fetch(`${origin}/api/v1/me`, {
    headers: { Cookie: sessionCookie },
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000)
  })
  if (principalResponse.status !== 200) {
    throw new Error('Stateful auth principal lookup did not succeed.')
  }
  validateStatefulPrincipal(
    parseUniqueKeyJson(await readBoundedAuthResponse(principalResponse))
  )

  const counts = run('docker', [
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
    `SELECT (SELECT count(*) FROM "User" WHERE email = '${email}'), (SELECT count(*) FROM "Account" WHERE "userId" = (SELECT id FROM "User" WHERE email = '${email}')), (SELECT count(*) FROM "Session" WHERE "userId" = (SELECT id FROM "User" WHERE email = '${email}'))`
  ]).stdout.trim()
  if (counts !== '1|1|1') {
    throw new Error('Stateful auth smoke persistence is incomplete.')
  }

  return {
    learnerCompatibility: await runLearnerCompatibilityProbe({
      origin,
      sessionCookie
    }),
    statefulAuth: {
      accountRows: 1,
      principalStatus: principalResponse.status,
      sessionRows: 1,
      signInStatus: signInResponse.status,
      signUpStatus: signUpResponse.status,
      userRows: 1
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
    evidence.schemaVersion !== 2 ||
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
    evidence.statefulAuth,
    [
      'accountRows',
      'principalStatus',
      'sessionRows',
      'signInStatus',
      'signUpStatus',
      'userRows'
    ],
    'Runtime stateful auth evidence'
  )
  if (
    evidence.statefulAuth.accountRows !== 1 ||
    evidence.statefulAuth.principalStatus !== 200 ||
    evidence.statefulAuth.sessionRows !== 1 ||
    evidence.statefulAuth.signInStatus !== 200 ||
    evidence.statefulAuth.signUpStatus !== 200 ||
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
    seedLearnerCompatibilityFixture({
      containerName: databaseContainer,
      databaseAdminUser,
      databaseName
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
    const runtimeSensitiveValues = [
      runtimeEnvironment.AUTH_EMAIL_WEBHOOK_SECRET,
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
      containerName: databaseContainer,
      databaseAdminUser,
      databaseName,
      origin,
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
      schemaVersion: 2,
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
