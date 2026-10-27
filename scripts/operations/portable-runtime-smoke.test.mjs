import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  assertExpectedRuntimeImageId,
  cleanupDockerResource,
  combineRuntimeSmokeErrors,
  createPostgresReadinessArguments,
  createPostgresCertificateArguments,
  createRuntimePublicCertificateArguments,
  seedLearnerCompatibilityFixture,
  createRuntimeEnvironment,
  isCanonicalRuntimeAssetPath,
  readBoundedAuthResponse,
  readProductionSessionCookie,
  readRuntimeContainerImageId,
  readSafeRuntimeFailureDiagnostics,
  runPortableRuntimeSmokeCli,
  selectCurrentMigrationNames,
  selectLearnerCompatibilityFixture,
  readCanonicalLearnerFixture,
  runStatefulAuthCompatibilityProbe,
  controlledSessionProgram,
  canonicalSeedProgram,
  assertHostPrismaClient,
  readSafeCanonicalSeedFailure,
  validateLearnerBookmark,
  validateLearnerQuestionSummary,
  validateStatefulPrincipal,
  verifyPackagedAccountErasureCommand,
  verifyPortableRuntimeSmokeEvidence
} from './portable-runtime-smoke.mjs'

const releaseId = '1234567890abcdef1234567890abcdef12345678'
const fixture = readCanonicalLearnerFixture()
const questionSummary = () => ({
  difficulty: fixture.difficulty,
  id: fixture.questionId,
  level: fixture.level,
  questionTextPreview: fixture.questionText,
  questionType: fixture.questionType,
  questionVersionId: fixture.versionId,
  subject: fixture.subject,
  tags: fixture.tags.map((tag) => ({ ...tag }))
})

test('stateful auth response reader cancels an unbounded chunked body', async () => {
  let cancelled = false
  const response = new Response(
    new ReadableStream({
      cancel: () => {
        cancelled = true
      },
      start: (controller) => {
        controller.enqueue(new Uint8Array(10_000))
        controller.enqueue(new Uint8Array(10_000))
      }
    })
  )

  await assert.rejects(
    () => readBoundedAuthResponse(response),
    /response is too large/u
  )
  assert.equal(cancelled, true)
})

test('stateful auth response reader cancels a declared oversized body', async () => {
  let cancelled = false
  const response = new Response(
    new ReadableStream({
      cancel: () => {
        cancelled = true
      }
    }),
    { headers: { 'Content-Length': '16385' } }
  )

  await assert.rejects(
    () => readBoundedAuthResponse(response),
    /response is too large/u
  )
  assert.equal(cancelled, true)
})

test('Docker cleanup fails closed when inventory or removal is uncertain', () => {
  const failedInventory = () => ({ status: 1, stderr: 'daemon unavailable' })
  assert.equal(
    cleanupDockerResource('container', 'nihongo-test', failedInventory),
    false
  )

  const absentCalls = []
  assert.equal(
    cleanupDockerResource(
      'network',
      'nihongo-test',
      (command, argumentsList) => {
        absentCalls.push([command, argumentsList])
        return { status: 0, stdout: '' }
      }
    ),
    true
  )
  assert.deepEqual(absentCalls, [
    ['docker', ['network', 'ls', '--quiet', '--filter', 'name=^nihongo-test$']]
  ])

  const results = [
    { status: 0, stdout: 'resource-id\n' },
    { status: 0, stdout: '' },
    { status: 0, stdout: '' }
  ]
  const calls = []
  assert.equal(
    cleanupDockerResource('container', 'nihongo-test', (...argumentsList) => {
      calls.push(argumentsList)
      return results.shift()
    }),
    true
  )
  assert.deepEqual(calls[1], [
    'docker',
    ['rm', '-f', 'nihongo-test'],
    { allowFailure: true }
  ])
  assert.equal(results.length, 0)
})

test('runtime evidence binds the immutable image used by the container', () => {
  const imageId = `sha256:${'a'.repeat(64)}`
  const calls = []
  assert.equal(
    readRuntimeContainerImageId('nihongo-runtime', (...argumentsList) => {
      calls.push(argumentsList)
      return { status: 0, stdout: `${imageId}\n` }
    }),
    imageId
  )
  assert.deepEqual(calls, [
    [
      'docker',
      ['container', 'inspect', '--format', '{{.Image}}', 'nihongo-runtime']
    ]
  ])
  assert.throws(
    () =>
      readRuntimeContainerImageId('nihongo-runtime', () => ({
        status: 0,
        stdout: 'mutable-tag\n'
      })),
    /image identity is invalid/u
  )
  assert.equal(assertExpectedRuntimeImageId(imageId, imageId), imageId)
  assert.throws(
    () => assertExpectedRuntimeImageId(imageId, `sha256:${'b'.repeat(64)}`),
    /does not match evidence/u
  )
  assert.throws(
    () => assertExpectedRuntimeImageId(imageId, 'mutable-tag'),
    /Expected runtime image identity is invalid/u
  )
})

test('runtime and cleanup failures retain both safe diagnostics', () => {
  const operationError = new Error('readiness failed with exit code 1')
  const cleanupError = new Error(
    'cleanup did not complete: runtime-container:nihongo-p11-app-test'
  )
  const combined = combineRuntimeSmokeErrors(operationError, cleanupError)

  assert.ok(combined instanceof AggregateError)
  assert.deepEqual(combined.errors, [operationError, cleanupError])
  assert.match(combined.message, /readiness failed with exit code 1/u)
  assert.match(combined.message, /runtime-container:nihongo-p11-app-test/u)
  assert.equal(
    combineRuntimeSmokeErrors(operationError, undefined),
    operationError
  )
  assert.equal(combineRuntimeSmokeErrors(undefined, cleanupError), cleanupError)
})

test('runtime failure diagnostics are bounded and redact exact secrets', () => {
  const secret = 'runtime-secret-value'
  const diagnostics = readSafeRuntimeFailureDiagnostics(
    'nihongo-runtime',
    [secret],
    (command, argumentsList, options) => {
      assert.equal(command, 'docker')
      assert.deepEqual(argumentsList, [
        'logs',
        '--tail',
        '40',
        'nihongo-runtime'
      ])
      assert.deepEqual(options, { allowFailure: true })
      return {
        status: 0,
        stderr: `startup failed for ${secret}`,
        stdout: ''
      }
    }
  )

  assert.equal(diagnostics, 'startup failed for [REDACTED]')

  const splitSecretDiagnostics = readSafeRuntimeFailureDiagnostics(
    'nihongo-runtime',
    [secret],
    () => ({
      status: 0,
      stderr: `${'x'.repeat(100)}${secret}${'y'.repeat(3_990)}`,
      stdout: ''
    })
  )
  assert.equal(splitSecretDiagnostics.length, 4_000)
  assert.equal(splitSecretDiagnostics.includes(secret.slice(10)), false)
  assert.match(splitSecretDiagnostics, /^\[REDACTED\]y+/u)
})

test('stateful auth principal validation is strict and privacy-safe', () => {
  const principal = {
    kind: 'USER',
    user: {
      id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
      name: 'Phase 11 smoke',
      role: 'USER',
      targetLevel: 'N5'
    }
  }
  assert.equal(validateStatefulPrincipal(principal), principal)
  assert.throws(
    () =>
      validateStatefulPrincipal({
        ...principal,
        user: { ...principal.user, email: 'leak@example.test' }
      }),
    /invalid key set/u
  )
  const missingId = {
    name: principal.user.name,
    role: principal.user.role,
    targetLevel: principal.user.targetLevel
  }
  assert.throws(
    () => validateStatefulPrincipal({ ...principal, user: missingId }),
    /invalid key set/u
  )
})

test('learner compatibility question validation is exact and privacy-safe', () => {
  const question = questionSummary()
  assert.equal(validateLearnerQuestionSummary(question, fixture), question)
  assert.throws(
    () =>
      validateLearnerQuestionSummary(
        {
          ...question,
          contentFingerprint: 'private'
        },
        fixture
      ),
    /invalid key set/u
  )
  assert.throws(
    () =>
      validateLearnerQuestionSummary(
        {
          ...question,
          tags: question.tags.map((tag) => ({
            ...tag,
            normalizedName: 'private'
          }))
        },
        fixture
      ),
    /invalid key set/u
  )
})

test('learner compatibility bookmark validation requires an exact canonical response', () => {
  const question = questionSummary()
  const bookmark = {
    availability: 'AVAILABLE',
    createdAt: '2026-10-01T00:00:00.000Z',
    question,
    questionId: question.id
  }

  assert.equal(validateLearnerBookmark(bookmark, fixture), bookmark)
  assert.throws(
    () =>
      validateLearnerBookmark(
        { ...bookmark, internalNote: 'private' },
        fixture
      ),
    /invalid key set/u
  )
  assert.throws(
    () =>
      validateLearnerBookmark(
        {
          ...bookmark,
          createdAt: 'Thu, 01 Oct 2026 00:00:00 GMT'
        },
        fixture
      ),
    /contract is invalid/u
  )
})

test('portable runtime accepts only one hardened production session cookie', () => {
  const valid = new Response('{}', {
    headers: {
      'Set-Cookie':
        '__Secure-nihongo.session_token=value; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax; Secure'
    }
  })
  assert.equal(
    readProductionSessionCookie(valid),
    '__Secure-nihongo.session_token=value'
  )

  for (const setCookie of [
    'nihongo.session_token=value; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax',
    '__Secure-nihongo.session_token=value; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax',
    '__Secure-nihongo.session_token=value; Path=/; HttpOnly; SameSite=Lax; Secure'
  ]) {
    assert.throws(
      () =>
        readProductionSessionCookie(
          new Response('{}', { headers: { 'Set-Cookie': setCookie } })
        ),
      /production session cookie/u
    )
  }

  const ambiguousHeaders = new Headers()
  ambiguousHeaders.append(
    'Set-Cookie',
    '__Secure-nihongo.session_token=value; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax; Secure'
  )
  ambiguousHeaders.append(
    'Set-Cookie',
    'nihongo.session_token=shadow; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax'
  )
  assert.throws(
    () =>
      readProductionSessionCookie(
        new Response('{}', { headers: ambiguousHeaders })
      ),
    /production session cookie/u
  )
})

test('portable runtime environment is production-shaped without migration credentials', () => {
  const environment = createRuntimeEnvironment({
    databaseHost: 'database',
    databaseName: 'nihongo_smoke_test',
    databasePassword: 'a'.repeat(48),
    gatewayPassword: 'b'.repeat(48),
    schemaName: `phase7_${'c'.repeat(32)}_test`,
    releaseId
  })

  assert.equal(environment.NODE_ENV, 'production')
  assert.equal(environment.AUTH_TRUSTED_PROXY_CIDRS, '127.0.0.1/32,::1/128')
  assert.equal(environment.NODE_EXTRA_CA_CERTS, '/certs/server.crt')
  const validation = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict';
        import { readFileSync } from 'node:fs';
        import { parseApiEnvironment } from './src/config/env.ts';
        const environment = JSON.parse(readFileSync(0, 'utf8'));
        assert.deepEqual(parseApiEnvironment(environment).AUTH_TRUSTED_PROXY_CIDRS,
          ['127.0.0.1/32', '::1/128']);
        for (const value of [undefined, '', 'invalid']) {
          assert.throws(() => parseApiEnvironment({ ...environment, AUTH_TRUSTED_PROXY_CIDRS: value }),
            (error) => error.name === 'EnvironmentValidationError' &&
              error.invalidFields.includes('AUTH_TRUSTED_PROXY_CIDRS'));
        }
      `
    ],
    {
      cwd: fileURLToPath(new URL('../../apps/api', import.meta.url)),
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      input: JSON.stringify(environment)
    }
  )
  assert.ifError(validation.error)
  assert.equal(validation.status, 0)
  assert.equal(validation.stdout, '')
  assert.equal(validation.stderr, '')
  assert.equal(environment.DEPLOYMENT_ENVIRONMENT, 'TEST')
  assert.equal(environment.ADMIN_CMS_MODE, 'disabled')
  assert.equal(environment.PRACTICE_CONTRACT_RUNTIME, 'v1-v2')
  assert.equal(environment.RELEASE_ID, releaseId)
  assert.match(environment.DATABASE_URL, /sslmode=verify-full$/u)
  const app = new URL(environment.DATABASE_URL)
  const gateway = new URL(environment.AUTH_GATEWAY_DATABASE_URL)
  assert.equal(app.username, 'nihongo_test_app_login')
  assert.equal(gateway.username, 'nihongo_test_auth_gateway_login')
  assert.equal(
    app.searchParams.get('schema'),
    gateway.searchParams.get('schema')
  )
  assert.notEqual(app.password, gateway.password)
  for (const url of [app, gateway]) {
    assert.deepEqual([...url.searchParams.keys()].sort(), ['schema', 'sslmode'])
    assert.equal(url.searchParams.get('sslmode'), 'verify-full')
  }
  assert.equal('AUTH_EMAIL_DELIVERY_MODE' in environment, false)
  assert.equal('PHASE7_MIGRATION_DATABASE_URL' in environment, false)
  assert.equal('PRODUCTION_DATABASE_URL' in environment, false)
  assert.notEqual(
    environment.BETTER_AUTH_SECRET,
    environment.GUEST_COOKIE_SECRET
  )
})

test('PostgreSQL readiness probes only the final TCP listener', () => {
  assert.deepEqual(
    createPostgresReadinessArguments(
      'nihongo-database',
      'migration_user',
      'nihongo_test'
    ),
    [
      'exec',
      'nihongo-database',
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'migration_user',
      '-d',
      'nihongo_test'
    ]
  )
})

test('portable runtime requires the pinned current48 inventory and rejects count/checksum drift', () => {
  const source = fileURLToPath(
    new URL('../../apps/api/prisma/migrations/', import.meta.url)
  )
  const names = selectCurrentMigrationNames(source)
  assert.equal(names.length, 48)
  assert.equal(names[36], '20261009092000_phase7_n4_n2_revision2_digest_fix')
  assert.equal(names.at(-1), '20261028090000_sso_account_erasure_worker_queue')
  const directory = mkdtempSync(join(tmpdir(), 'nihongo-p11-migrations-'))
  try {
    cpSync(source, directory, { recursive: true })
    rmSync(join(directory, names.at(-1)), { recursive: true })
    assert.throws(
      () => selectCurrentMigrationNames(directory),
      /current-48 migration inventory/u
    )
    cpSync(source, directory, { recursive: true })
    writeFileSync(join(directory, names[0], 'migration.sql'), 'changed')
    assert.throws(
      () => selectCurrentMigrationNames(directory),
      /current-48 migration inventory/u
    )
    rmSync(join(directory, names[0]), { recursive: true })
    assert.throws(
      () => selectCurrentMigrationNames(directory),
      /current-48 migration inventory/u
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('portable runtime executes the packaged account erasure command fail-closed', () => {
  const imageId = `sha256:${'a'.repeat(64)}`
  let invocation
  assert.doesNotThrow(() =>
    verifyPackagedAccountErasureCommand(
      imageId,
      (command, argumentsList, options) => {
        invocation = { argumentsList, command, options }
        return {
          status: 1,
          stderr: '{"event":"auth.account_erasure.failed"}\n',
          stdout: ''
        }
      }
    )
  )
  assert.deepEqual(invocation, {
    command: 'docker',
    argumentsList: [
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
    options: { allowFailure: true }
  })
  for (const result of [
    { status: 0, stderr: '', stdout: '' },
    {
      status: 1,
      stderr: 'private child diagnostics',
      stdout: ''
    }
  ]) {
    assert.throws(
      () => verifyPackagedAccountErasureCommand(imageId, () => result),
      /did not fail closed/u
    )
  }
})

test('canonical65 selection proves an existing unique tag without copying seed rows', () => {
  assert.equal(fixture.questionId, '565d941a-3f60-4e7d-8d87-01a467eacfad')
  assert.equal(fixture.versionId, '16a02b21-7b83-4205-8610-182f76dcacd5')
  assert.equal(fixture.tagId, '4d89c6c7-7e47-44c6-8ca4-e56657013c78')
  assert.equal(fixture.tags.length, 2)
  assert.throws(() => selectLearnerCompatibilityFixture([]), /exactly 65/u)
  const shared = Array.from({ length: 65 }, (_, index) => ({
    questionId: index ? String(index) : fixture.questionId,
    level: 'N5',
    questionText: 'test',
    tags: fixture.tags
  }))
  assert.throws(
    () => selectLearnerCompatibilityFixture(shared),
    /existing unique tag/u
  )
  for (const change of [
    { id: 'different' },
    { questionVersionId: 'different' },
    { difficulty: 'HARD' },
    { tags: fixture.tags.slice(0, 1) },
    { tags: [fixture.tags[0], fixture.tags[0]] }
  ]) {
    assert.throws(
      () =>
        validateLearnerQuestionSummary(
          { ...questionSummary(), ...change },
          fixture
        ),
      /contract is invalid/u
    )
  }
})

test('controlled TEST probe binds the exact actor, Google persistence, question and bookmarks to one cookie', async () => {
  const actor = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
  const question = questionSummary()
  const bookmark = {
    availability: 'AVAILABLE',
    createdAt: '2026-10-01T00:00:00.000Z',
    question,
    questionId: question.id
  }
  const cookie =
    '__Secure-nihongo.session_token=fixture; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax; Secure'
  const nativeCalls = []
  const httpCalls = []
  const input = {
    database: {
      containerName: 'owned-db',
      databaseUser: 'owned-admin',
      databaseName: 'nihongo_smoke_test'
    },
    runtimeContainer: 'owned-runtime',
    schemaName: `phase7_${'a'.repeat(32)}_test`,
    origin: 'http://127.0.0.1:4567',
    suffix: '012345abcdef',
    fixture,
    runCommand: (command, args, options) => {
      nativeCalls.push({ command, args, options })
      return {
        status: 0,
        stdout:
          nativeCalls.length === 1
            ? JSON.stringify({
                cookie,
                kind: 'controlled-test-session',
                provider: 'google'
              })
            : actor
      }
    },
    fetchResponse: async (url, options) => {
      httpCalls.push({ url, options })
      assert.equal(
        options.headers.Cookie,
        '__Secure-nihongo.session_token=fixture'
      )
      if (url.endsWith('/api/v1/me'))
        return Response.json({
          kind: 'USER',
          user: {
            id: actor,
            name: 'Phase 11 smoke',
            role: 'USER',
            targetLevel: 'N5'
          }
        })
      if (options.method === 'PUT')
        return Response.json(bookmark, { status: 201 })
      return Response.json({
        items: [url.includes('/questions?') ? question : bookmark],
        page: 1,
        pageSize: 20,
        total: 1
      })
    }
  }
  const result = await runStatefulAuthCompatibilityProbe(input)
  assert.equal(httpCalls.length, 4)
  assert.equal(
    new URL(httpCalls[1].url).searchParams.get('tag'),
    fixture.tagLabel
  )
  assert.equal(nativeCalls.length, 2)
  assert.match(nativeCalls[0].options.input, /createSsoIdentityRepository/u)
  assert.match(
    nativeCalls[1].options.input,
    /s\."issuerProtocolVersion" = 'PHASE7_V1'/u
  )
  assert.doesNotMatch(
    nativeCalls[1].options.input,
    /s\."issuerProtocolVersion" = '(?:V1|LEGACY)'/u
  )
  assert.match(
    nativeCalls[1].options.input,
    /s\."authorityGeneration" = u\."authorityGeneration"/u
  )
  assert.deepEqual(result.statefulAuth, {
    accountRows: 1,
    principalStatus: 200,
    sessionRows: 1,
    userRows: 1,
    fixtureKind: 'controlled-test-session',
    provider: 'google',
    providerExchangeVerified: false
  })
  const wrongPrincipal = async () =>
    Response.json({
      kind: 'USER',
      user: {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
        name: 'Phase 11 smoke',
        role: 'USER',
        targetLevel: 'N5'
      }
    })
  await assert.rejects(
    () =>
      runStatefulAuthCompatibilityProbe({
        ...input,
        runCommand: (_command, args) => ({
          stdout: args.includes('node')
            ? JSON.stringify({
                cookie,
                kind: 'controlled-test-session',
                provider: 'google'
              })
            : actor
        }),
        fetchResponse: wrongPrincipal
      }),
    /actor does not match/u
  )
  await assert.rejects(
    () =>
      runStatefulAuthCompatibilityProbe({
        ...input,
        runCommand: () => ({
          stdout: JSON.stringify({
            cookie,
            kind: 'controlled-test-session',
            provider: 'credential'
          })
        })
      }),
    /classification is invalid/u
  )
})

test('TEST preparation programs keep canonical seed/owned issuance boundaries and reject production fixture use', async () => {
  assert.match(canonicalSeedProgram, /assertSafePhase7MigrationDatabase/u)
  assert.match(canonicalSeedProgram, /seedQuestionCatalog\(scoped\)/u)
  assert.doesNotMatch(
    canonicalSeedProgram + controlledSessionProgram,
    /dotenv|sign-up\/email|sign-in\/email|INSERT INTO|createServer/u
  )
  const execute = Object.getPrototypeOf(async () => {}).constructor
  const body = controlledSessionProgram.replace(/^import .*;$/gmu, '')
  const fakeProcess = {
    env: {
      NODE_ENV: 'production',
      DEPLOYMENT_ENVIRONMENT: 'PRODUCTION',
      AUTH_GATEWAY_DATABASE_URL: `postgresql://test@127.0.0.1/nihongo_test?schema=phase7_${'a'.repeat(32)}_test`
    }
  }
  let touched = false
  await assert.rejects(
    () =>
      new execute(
        'createRoleDatabaseRuntime',
        'createSsoIdentityRepository',
        'createPhase7SessionCookie',
        'readFileSync',
        'process',
        body
      )(
        () => {
          touched = true
        },
        () => {},
        () => {},
        () => JSON.stringify({ suffix: '012345abcdef' }),
        fakeProcess
      ),
    /TEST session target is invalid/u
  )
  assert.equal(touched, false)

  const createdAt = new Date('2026-10-01T00:00:00.000Z')
  const expiresAt = new Date('2026-10-08T00:00:00.000Z')
  const calls = []
  const session = {
    kind: 'SESSION_CONFIRMED',
    token: 'disposable-test-token',
    createdAt,
    expiresAt
  }
  const testProcess = {
    env: {
      ...fakeProcess.env,
      DEPLOYMENT_ENVIRONMENT: 'TEST',
      BETTER_AUTH_SECRET: 'test-fixture-secret'
    },
    stdout: { write: (value) => calls.push(JSON.parse(value)) }
  }
  const invoke = async (issued) =>
    await new execute(
      'createRoleDatabaseRuntime',
      'createSsoIdentityRepository',
      'createPhase7SessionCookie',
      'readFileSync',
      'process',
      body
    )(
      () => ({
        client: {},
        disconnect: async () => {
          calls.push('disconnect')
        }
      }),
      () => ({
        signIn: async (identity) => {
          assert.equal(identity.provider, 'google')
          calls.push('signIn')
          return issued
        }
      }),
      (options) => {
        assert.equal(options.token, session.token)
        assert.equal(options.now, createdAt)
        assert.equal(options.expiresAt, expiresAt)
        assert.equal(options.isProduction, true)
        assert.equal(options.rememberMe, true)
        calls.push('signCookie')
        return 'signed-fixture-cookie'
      },
      () => JSON.stringify({ suffix: '012345abcdef' }),
      testProcess
    )
  await invoke(session)
  assert.deepEqual(calls, [
    'signIn',
    'signCookie',
    {
      cookie: 'signed-fixture-cookie',
      kind: 'controlled-test-session',
      provider: 'google'
    },
    'disconnect'
  ])
  calls.length = 0
  await assert.rejects(
    () => invoke({ kind: 'IDENTITY_CONFLICT' }),
    /not confirmed/u
  )
  assert.deepEqual(calls, ['signIn', 'disconnect'])
})

test('portable runtime smoke evidence is closed and bound to TEST', () => {
  const evidence = {
    schemaVersion: 3,
    evidenceClassification: 'TEST',
    profile: 'isolated-production-mode',
    releaseId,
    imageId: `sha256:${'a'.repeat(64)}`,
    migrationCount: 48,
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
    learnerCompatibility: {
      bookmarkCreateStatus: 201,
      bookmarkListStatus: 200,
      bookmarkRows: 1,
      questionListStatus: 200,
      questionRows: 1
    },
    statefulAuth: {
      accountRows: 1,
      principalStatus: 200,
      sessionRows: 1,
      fixtureKind: 'controlled-test-session',
      provider: 'google',
      providerExchangeVerified: false,
      userRows: 1
    },
    smoke: {
      schemaVersion: 1,
      environment: 'TEST',
      releaseId,
      targetFingerprintSha256: 'b'.repeat(64),
      checks: [
        { durationMs: 1, path: '/health/live', status: 200 },
        { durationMs: 1, path: '/health/ready', status: 200 },
        { durationMs: 1, path: '/', status: 200 },
        { durationMs: 1, path: '/login', status: 200 },
        { durationMs: 1, path: '/assets/app-ABC.js', status: 200 },
        { durationMs: 1, path: '/mockServiceWorker.js', status: 404 }
      ]
    },
    shutdown: { exitCode: 0, signal: 'SIGTERM' }
  }

  assert.equal(verifyPortableRuntimeSmokeEvidence(evidence), evidence)
  for (const change of [
    { signInStatus: 200 },
    { providerExchangeVerified: true },
    { fixtureKind: 'google-login' }
  ]) {
    assert.throws(
      () =>
        verifyPortableRuntimeSmokeEvidence({
          ...evidence,
          statefulAuth: { ...evidence.statefulAuth, ...change }
        }),
      /invalid key set|stateful auth evidence/u
    )
  }
  assert.throws(
    () =>
      verifyPortableRuntimeSmokeEvidence({
        ...evidence,
        evidenceClassification: 'PRODUCTION'
      }),
    /identity is invalid/u
  )
  assert.throws(
    () => verifyPortableRuntimeSmokeEvidence({ ...evidence, provider: 'x' }),
    /invalid key set/u
  )
  assert.throws(
    () =>
      verifyPortableRuntimeSmokeEvidence({
        ...evidence,
        statefulAuth: { ...evidence.statefulAuth, sessionRows: 0 }
      }),
    /stateful auth evidence/u
  )
  assert.throws(
    () =>
      verifyPortableRuntimeSmokeEvidence({
        ...evidence,
        learnerCompatibility: {
          ...evidence.learnerCompatibility,
          bookmarkRows: 0
        }
      }),
    /learner compatibility evidence/u
  )
  for (const path of [
    '/assets/../secret',
    '/assets//app.js',
    '/assets/./app.js',
    '/assets/.hidden',
    '/assets/-lead.js',
    '/assets/foo~bar.js'
  ]) {
    assert.equal(isCanonicalRuntimeAssetPath(path), false)
    assert.throws(
      () =>
        verifyPortableRuntimeSmokeEvidence({
          ...evidence,
          smoke: {
            ...evidence.smoke,
            checks: evidence.smoke.checks.map((check, index) =>
              index === 4 ? { ...check, path } : check
            )
          }
        }),
      /asset checks are invalid/u
    )
  }
})

test('portable runtime evidence CLI rejects ambiguous and linked input', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nihongo-p11-evidence-'))
  try {
    const duplicatePath = join(directory, 'duplicate.json')
    const linkedPath = join(directory, 'linked.json')
    const linkedTargetPath = join(directory, 'linked-target.json')
    writeFileSync(duplicatePath, '{"schemaVersion":1,"schemaVersion":2}', {
      mode: 0o600
    })
    writeFileSync(linkedTargetPath, '{}', { mode: 0o600 })
    symlinkSync(linkedTargetPath, linkedPath)

    await assert.rejects(
      () =>
        runPortableRuntimeSmokeCli([
          '--mode',
          'verify',
          '--input',
          duplicatePath
        ]),
      /bounded regular JSON file/u
    )
    await assert.rejects(
      () =>
        runPortableRuntimeSmokeCli(['--mode', 'verify', '--input', linkedPath]),
      /bounded regular JSON file/u
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('host seed prerequisite and diagnostics never include arbitrary child output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nihongo-host-prisma-'))
  const sentinel =
    'postgresql://private:private-token@203.0.113.9/private?password=secret'
  try {
    assert.throws(
      () => assertHostPrismaClient(directory),
      /HOST_PRISMA_CLIENT_UNAVAILABLE/u
    )
    mkdirSync(join(directory, 'src/generated/prisma'), { recursive: true })
    writeFileSync(
      join(directory, 'src/generated/prisma/client.ts'),
      '// TEST placeholder'
    )
    assert.doesNotThrow(() => assertHostPrismaClient(directory))
    assert.equal(
      readSafeCanonicalSeedFailure(sentinel),
      'phase=host-seed code=UNCLASSIFIED'
    )
    for (const record of [
      { phase: sentinel, code: 'P2010' },
      { phase: 'canonical-seed', code: sentinel },
      { phase: 'canonical-seed', code: 'P2010', databaseCode: sentinel },
      { phase: 'canonical-seed', code: 'P2010', message: sentinel }
    ]) {
      const result = readSafeCanonicalSeedFailure(
        'PORTABLE_TEST_SETUP ' + JSON.stringify(record)
      )
      assert.equal(result, 'phase=host-seed code=UNCLASSIFIED')
      assert.equal(result.includes(sentinel), false)
    }
    assert.equal(
      readSafeCanonicalSeedFailure(
        'PORTABLE_TEST_SETUP ' +
          JSON.stringify({
            phase: 'canonical-seed',
            code: 'P2010',
            databaseCode: '42501'
          })
      ),
      'phase=canonical-seed code=P2010 databaseCode=42501'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('canonical seed child preserves native failure with safe stage and code only', () => {
  const sentinel =
    'postgresql://private:private-token@127.0.0.1:1/private?password=secret'
  const prelude =
    "\nconst scenario = JSON.parse(process.env.PORTABLE_SEED_STUB_SCENARIO);\nconst secretError = (code, databaseCode) => Object.assign(new Error('private-token postgresql://private:password@127.0.0.1/secret SQL parameter'), { code, meta: { code: databaseCode } });\nclass PrismaClient {\n  async $transaction(callback) {\n    return await callback({\n      $executeRawUnsafe: async () => 0,\n      $queryRawUnsafe: async () => [{ role: 'nihongo_phase7_owner', login: 'nihongo_test_phase7_migration_login' }]\n    });\n  }\n  async $queryRawUnsafe() { return [{ role: 'nihongo_phase7_migration' }]; }\n  async $disconnect() { if (scenario.disconnectCode) throw secretError(scenario.disconnectCode); }\n}\nconst loadModule = async (name) => {\n  if (scenario.importCode) throw secretError(scenario.importCode);\n  if (name === '@prisma/adapter-pg') return { PrismaPg: class {} };\n  if (name === './src/generated/prisma/client.ts') return { PrismaClient };\n  if (name === './prisma/seedQuestionCatalog.ts') return {\n    seedQuestionCatalog: async () => {\n      if (scenario.seedCode) throw secretError(scenario.seedCode, scenario.databaseCode);\n      return { insertedCount: scenario.insertedCount ?? 65, verifiedCount: 0 };\n    }\n  };\n  if (name === './src/db/databaseTargetGuard.ts') return { assertSafePhase7MigrationDatabase: () => {} };\n  if (name === './src/db/databaseOptions.ts') return {\n    createPostgresStartupOptions: () => '',\n    getPostgresSchema: (value) => new URL(value).searchParams.get('schema')\n  };\n  throw new Error('Unexpected stub module.');\n};\n"
  const body = canonicalSeedProgram.replaceAll(
    'await import(',
    'await loadModule('
  )
  assert.equal(body.includes('await import('), false)
  for (const scenario of [
    {
      importCode: 'ERR_MODULE_NOT_FOUND',
      phase: 'host-prisma-adapter',
      code: 'ERR_MODULE_NOT_FOUND'
    },
    {
      seedCode: 'P2010',
      databaseCode: '42501',
      phase: 'canonical-seed',
      code: 'P2010'
    },
    {
      seedCode: 'private-token',
      phase: 'canonical-seed',
      code: 'UNCLASSIFIED'
    },
    { insertedCount: 64, phase: 'seed-count', code: 'UNCLASSIFIED' },
    { disconnectCode: 'P1017', phase: 'disconnect', code: 'P1017' },
    {
      seedCode: 'P2010',
      disconnectCode: 'P1017',
      phase: 'canonical-seed',
      code: 'P2010'
    },
    { success: true }
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', prelude + body],
      {
        encoding: 'utf8',
        input: JSON.stringify({
          databaseUrl:
            'postgresql://test:private-token@127.0.0.1:1/nihongo_test?schema=phase7_' +
            'a'.repeat(32) +
            '_test',
          runtimeDatabaseUrl: sentinel
        }),
        env: {
          ...process.env,
          PORTABLE_SEED_STUB_SCENARIO: JSON.stringify(scenario)
        }
      }
    )
    assert.ifError(result.error)
    assert.equal(result.status, scenario.success ? 0 : 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr.includes('private-token'), false)
    assert.equal(result.stderr.includes('postgresql://'), false)
    if (!scenario.success) {
      const diagnostic = readSafeCanonicalSeedFailure(result.stderr)
      assert.ok(diagnostic.includes('phase=' + scenario.phase), diagnostic)
      assert.ok(diagnostic.includes('code=' + scenario.code), diagnostic)
      if (scenario.databaseCode)
        assert.ok(diagnostic.includes('databaseCode=42501'))
    } else assert.equal(result.stderr, '')
  }
})

test('portable TLS command arguments bind owned DNS and loopback names and expose only the public certificate', () => {
  const host = 'nihongo-p11-db-abc123'
  const directory = '/owned-test-cert'
  const argv = createPostgresCertificateArguments(host, directory)
  assert.deepEqual(argv, [
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
    'subjectAltName=DNS:nihongo-p11-db-abc123,DNS:localhost,IP:127.0.0.1',
    '-keyout',
    join(directory, 'server.key'),
    '-out',
    join(directory, 'server.crt')
  ])
  assert.deepEqual(createRuntimePublicCertificateArguments(directory), [
    '--volume',
    join(directory, 'server.crt') + ':/certs/server.crt:ro'
  ])
  assert.equal(
    createRuntimePublicCertificateArguments(directory)
      .join(' ')
      .includes('server.key'),
    false
  )
})

test('canonical seed child receives its owned public certificate before Node startup and retains the narrow environment', () => {
  let prerequisiteChecks = 0
  let captured
  const source = `return (${seedLearnerCompatibilityFixture.toString()});`
  const makeSeed = new Function(
    'assertHostPrismaClient',
    'run',
    'process',
    'join',
    'repositoryRoot',
    'testSetupEnvironment',
    'canonicalSeedProgram',
    source
  )
  const seed = makeSeed(
    () => {
      prerequisiteChecks += 1
    },
    (command, argv, options) => {
      captured = { command, argv, options }
      return { status: 0 }
    },
    process,
    join,
    '/repository',
    () => ({ PATH: '/pinned-node' }),
    canonicalSeedProgram
  )
  const migration =
    'postgresql://migration@127.0.0.1:5432/nihongo_test?schema=phase7_test&sslmode=verify-full'
  const application =
    'postgresql://application@127.0.0.1:5432/nihongo_test?schema=phase7_test&sslmode=verify-full'
  assert.deepEqual(
    seed(migration, application, '/owned-test-cert/server.crt'),
    { status: 0 }
  )
  assert.equal(prerequisiteChecks, 1)
  assert.equal(captured.command, process.execPath)
  assert.deepEqual(captured.argv, [
    '--import',
    'tsx',
    '--input-type=module',
    '--eval',
    canonicalSeedProgram
  ])
  assert.equal(captured.options.cwd, join('/repository', 'apps/api'))
  assert.deepEqual(captured.options.env, {
    PATH: '/pinned-node',
    NODE_ENV: 'test',
    NODE_EXTRA_CA_CERTS: '/owned-test-cert/server.crt'
  })
  assert.deepEqual(JSON.parse(captured.options.input), {
    databaseUrl: migration,
    runtimeDatabaseUrl: application
  })
  assert.equal(captured.options.safeCanonicalSeedFailure, true)
})
