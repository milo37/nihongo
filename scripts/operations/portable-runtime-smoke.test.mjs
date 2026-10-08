import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertExpectedRuntimeImageId,
  cleanupDockerResource,
  combineRuntimeSmokeErrors,
  createPostgresReadinessArguments,
  createRuntimeEnvironment,
  isCanonicalRuntimeAssetPath,
  readBoundedAuthResponse,
  readProductionSessionCookie,
  readRuntimeContainerImageId,
  readSafeRuntimeFailureDiagnostics,
  runPortableRuntimeSmokeCli,
  selectPrePhase7MigrationNames,
  validateLearnerBookmark,
  validateLearnerQuestionSummary,
  validateStatefulPrincipal,
  verifyPortableRuntimeSmokeEvidence
} from './portable-runtime-smoke.mjs'

const releaseId = '1234567890abcdef1234567890abcdef12345678'

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
  const question = {
    difficulty: 'EASY',
    id: '00000000-0000-4000-8000-000000000101',
    level: 'N5',
    questionTextPreview: '「朝」の読み方を選んでください。',
    questionType: 'KANJI_READING',
    questionVersionId: '00000000-0000-4000-8000-000000000102',
    subject: 'VOCABULARY',
    tags: [
      {
        id: '00000000-0000-4000-8000-000000000120',
        label: 'phase11-smoke-tag'
      }
    ]
  }
  assert.equal(validateLearnerQuestionSummary(question), question)
  assert.throws(
    () =>
      validateLearnerQuestionSummary({
        ...question,
        contentFingerprint: 'private'
      }),
    /invalid key set/u
  )
  assert.throws(
    () =>
      validateLearnerQuestionSummary({
        ...question,
        tags: [{ ...question.tags[0], normalizedName: 'private' }]
      }),
    /invalid key set/u
  )
})

test('learner compatibility bookmark validation requires an exact canonical response', () => {
  const question = {
    difficulty: 'EASY',
    id: '00000000-0000-4000-8000-000000000101',
    level: 'N5',
    questionTextPreview: '「朝」の読み方を選んでください。',
    questionType: 'KANJI_READING',
    questionVersionId: '00000000-0000-4000-8000-000000000102',
    subject: 'VOCABULARY',
    tags: [
      {
        id: '00000000-0000-4000-8000-000000000120',
        label: 'phase11-smoke-tag'
      }
    ]
  }
  const bookmark = {
    availability: 'AVAILABLE',
    createdAt: '2026-10-01T00:00:00.000Z',
    question,
    questionId: question.id
  }

  assert.equal(validateLearnerBookmark(bookmark), bookmark)
  assert.throws(
    () => validateLearnerBookmark({ ...bookmark, internalNote: 'private' }),
    /invalid key set/u
  )
  assert.throws(
    () =>
      validateLearnerBookmark({
        ...bookmark,
        createdAt: 'Thu, 01 Oct 2026 00:00:00 GMT'
      }),
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
    databasePassword: 'test-password',
    databaseUser: 'runtime_user',
    releaseId
  })

  assert.equal(environment.NODE_ENV, 'production')
  assert.equal(environment.DEPLOYMENT_ENVIRONMENT, 'TEST')
  assert.equal(environment.ADMIN_CMS_MODE, 'disabled')
  assert.equal(environment.PRACTICE_CONTRACT_RUNTIME, 'v1-v2')
  assert.equal(environment.RELEASE_ID, releaseId)
  assert.match(
    environment.DATABASE_URL,
    /sslmode=require&uselibpqcompat=true$/u
  )
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

test('portable runtime smoke selects exactly the pre-Phase-7 boundary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nihongo-p11-migrations-'))
  try {
    for (let index = 0; index < 27; index += 1) {
      mkdirSync(
        join(directory, `202607${String(index).padStart(6, '0')}_migration`)
      )
    }
    mkdirSync(join(directory, '20260827100000_phase7_admin_cms_enums'))

    const selected = selectPrePhase7MigrationNames(directory)
    assert.equal(selected.length, 27)
    assert.equal(
      selected.includes('20260827100000_phase7_admin_cms_enums'),
      false
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('portable runtime smoke evidence is closed and bound to TEST', () => {
  const evidence = {
    schemaVersion: 2,
    evidenceClassification: 'TEST',
    profile: 'isolated-production-mode',
    releaseId,
    imageId: `sha256:${'a'.repeat(64)}`,
    migrationCount: 27,
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
      signInStatus: 200,
      signUpStatus: 200,
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
