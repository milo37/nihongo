import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { afterEach, test } from 'node:test'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  canonicalJsonText,
  normalizeWrapperFailure,
  rewritePrivatePaths,
  runNamedContainer,
  validateChildResult
} from './run-retained-validator.mjs'

const temporaryRoots = []

const createPrivateRoot = async () => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), 'nihongo-retained-wrapper-')
  )
  temporaryRoots.push(root)
  await chmod(root, 0o700)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  )
})

test('accepts only canonical success and closed failure envelopes', () => {
  const success = validateChildResult(
    {
      code: 0,
      stdout: Buffer.from(
        '{"command":"content:check","legacyItemCount":65,"policySnapshotSha256":"0000000000000000000000000000000000000000000000000000000000000000","schemaVersion":1,"status":"PASS","trackedPolicySnapshotCount":2,"validatorSourceCount":47}\n'
      ),
      stderr: Buffer.alloc(0)
    },
    'check'
  )
  assert.equal(success.exitCode, 0)

  const failure = validateChildResult(
    {
      code: 2,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(
        '{"code":"CONTENT_ARTIFACT_INVALID","message":"CONTENT_ARTIFACT_INVALID","schemaVersion":1}\n'
      )
    },
    'check'
  )
  assert.equal(failure.exitCode, 2)

  assert.throws(
    () =>
      validateChildResult(
        {
          code: 5,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(
            '{"code":"LEAKED","code":"CONTENT_INTERNAL_ERROR","message":"CONTENT_INTERNAL_ERROR","schemaVersion":1}\n'
          )
        },
        'check'
      ),
    /CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID/
  )
  assert.throws(
    () =>
      validateChildResult(
        {
          code: 0,
          stdout: Buffer.from(
            '{"command":"content:other","schemaVersion":1,"status":"PASS"}\n'
          ),
          stderr: Buffer.alloc(0)
        },
        'check'
      ),
    /CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID/
  )
  assert.throws(
    () =>
      validateChildResult(
        {
          code: 0,
          stdout: Buffer.from(
            '{"answer":"SECRET","command":"content:check","legacyItemCount":65,"policySnapshotSha256":"0000000000000000000000000000000000000000000000000000000000000000","schemaVersion":1,"status":"PASS","trackedPolicySnapshotCount":2,"validatorSourceCount":47}\n'
          ),
          stderr: Buffer.alloc(0)
        },
        'check'
      ),
    /CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID/
  )
  assert.throws(
    () =>
      validateChildResult(
        {
          code: 0,
          stdout: Buffer.from(
            '{"command":"content:check","legacyItemCount":65,"policySnapshotSha256":"0000000000000000000000000000000000000000000000000000000000000000","schemaVersion":1,"status":"REVIEW_REQUIRED","trackedPolicySnapshotCount":2,"validatorSourceCount":47}\n'
          ),
          stderr: Buffer.alloc(0)
        },
        'check'
      ),
    /CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID/
  )
})

test('normalizes wrapper failures without exposing internal text', () => {
  assert.deepEqual(
    normalizeWrapperFailure(
      new Error('CONTENT_PRIVATE_INPUT_DIRECTORY_NOT_ISOLATED')
    ),
    { code: 'CONTENT_ARTIFACT_INVALID', exitCode: 2 }
  )
  assert.deepEqual(
    normalizeWrapperFailure(new Error('/secret/path leaked here')),
    { code: 'CONTENT_INTERNAL_ERROR', exitCode: 5 }
  )
})

test('rejects success values that could carry hidden content', () => {
  assert.throws(
    () =>
      validateChildResult(
        {
          code: 0,
          stdout: Buffer.from(
            '{"bundleSha256":"0000000000000000000000000000000000000000000000000000000000000000","command":"content:duplicates","exactDuplicateCount":1,"schemaVersion":1,"status":"PASS","warningCount":1,"warnings":[]}\n'
          ),
          stderr: Buffer.alloc(0)
        },
        'duplicates'
      ),
    /CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID/
  )
  assert.throws(
    () =>
      validateChildResult(
        {
          code: 0,
          stdout: Buffer.from(
            '{"bundleSha256":"0000000000000000000000000000000000000000000000000000000000000000","command":"content:coverage","coverage":{"byLevelSubject":[{"count":0,"level":"SECRET_SENTINEL","subject":"VOCABULARY"}],"byLevelSubjectDifficulty":[],"byLevelSubjectType":[],"itemCount":0,"schemaVersion":1,"scope":"BUNDLE_ONLY"},"schemaVersion":1,"status":"PASS"}\n'
          ),
          stderr: Buffer.alloc(0)
        },
        'coverage'
      ),
    /CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID/
  )
  assert.throws(
    () =>
      validateChildResult(
        {
          code: 0,
          stdout: Buffer.from(
            '{"activationRevision":0,"activationSha256":"0000000000000000000000000000000000000000000000000000000000000000","command":"content:policy-activation-finalize","policySnapshotSha256":"0000000000000000000000000000000000000000000000000000000000000000","schemaVersion":1,"status":"PASS"}\n'
          ),
          stderr: Buffer.alloc(0)
        },
        'policy-activation-finalize'
      ),
    /CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID/
  )
  assert.throws(
    () =>
      validateChildResult(
        {
          code: 0,
          stdout: Buffer.from(
            '{"command":"content:check","legacyItemCount":0,"policySnapshotSha256":"0000000000000000000000000000000000000000000000000000000000000000","schemaVersion":1,"status":"PASS","trackedPolicySnapshotCount":0,"validatorSourceCount":0}\n'
          ),
          stderr: Buffer.alloc(0)
        },
        'check'
      ),
    /CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID/
  )
})

test('accepts only the complete ordered coverage matrix', () => {
  const levels = ['N5', 'N4', 'N3', 'N2', 'N1']
  const subjects = ['VOCABULARY', 'GRAMMAR', 'READING']
  const questionTypes = [
    'KANJI_READING',
    'ORTHOGRAPHY',
    'CONTEXT_VOCABULARY',
    'PARAPHRASE',
    'WORD_USAGE',
    'GRAMMAR_SELECT',
    'SENTENCE_ORDER',
    'TEXT_GRAMMAR',
    'SHORT_READING',
    'MEDIUM_READING',
    'LONG_READING',
    'INFO_RETRIEVAL'
  ]
  const difficulties = ['EASY', 'NORMAL', 'HARD']
  const allowedBySubject = {
    VOCABULARY: new Set(questionTypes.slice(0, 5)),
    GRAMMAR: new Set(questionTypes.slice(5, 8)),
    READING: new Set(questionTypes.slice(8))
  }
  const readingByLevel = {
    N5: new Set(['SHORT_READING', 'INFO_RETRIEVAL']),
    N4: new Set(['SHORT_READING', 'INFO_RETRIEVAL']),
    N3: new Set(['SHORT_READING', 'MEDIUM_READING', 'INFO_RETRIEVAL']),
    N2: new Set(['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL']),
    N1: new Set(['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL'])
  }
  const coverage = {
    schemaVersion: 1,
    scope: 'BUNDLE_ONLY',
    itemCount: 1,
    byLevelSubject: levels.flatMap((level) =>
      subjects.map((subject) => ({
        level,
        subject,
        count: level === 'N5' && subject === 'VOCABULARY' ? 1 : 0
      }))
    ),
    byLevelSubjectType: levels.flatMap((level) =>
      subjects.flatMap((subject) =>
        questionTypes.map((questionType) => ({
          level,
          subject,
          questionType,
          applicable:
            allowedBySubject[subject].has(questionType) &&
            (subject !== 'READING' || readingByLevel[level].has(questionType)),
          count:
            level === 'N5' &&
            subject === 'VOCABULARY' &&
            questionType === 'CONTEXT_VOCABULARY'
              ? 1
              : 0
        }))
      )
    ),
    byLevelSubjectDifficulty: levels.flatMap((level) =>
      subjects.flatMap((subject) =>
        difficulties.map((difficulty) => ({
          level,
          subject,
          difficulty,
          count:
            level === 'N5' &&
            subject === 'VOCABULARY' &&
            difficulty === 'NORMAL'
              ? 1
              : 0
        }))
      )
    )
  }
  const output = {
    schemaVersion: 1,
    command: 'content:coverage',
    status: 'PASS',
    bundleSha256: '0'.repeat(64),
    coverage
  }

  assert.equal(
    validateChildResult(
      {
        code: 0,
        stdout: Buffer.from(`${canonicalJsonText(output)}\n`),
        stderr: Buffer.alloc(0)
      },
      'coverage'
    ).exitCode,
    0
  )
})

test('groups exact private outputs in one empty 0700 mount', async () => {
  const root = await createPrivateRoot()
  const activationOutput = path.join(root, 'activation.json')
  const payloadOutput = path.join(root, 'payload.json')
  const rewritten = await rewritePrivatePaths([
    '--activation-output',
    activationOutput,
    '--signature-payload-output',
    payloadOutput
  ])
  assert.equal(rewritten.mounts.length, 1)
  assert.match(rewritten.args[1], /^\/private-artifacts\/output-0\//)
  assert.match(rewritten.args[3], /^\/private-artifacts\/output-0\//)
  await rewritten.revalidate()
})

test('accepts isolated 0600 inputs and rejects unsafe private directories', async () => {
  const inputRoot = await createPrivateRoot()
  const activation = path.join(inputRoot, 'activation.json')
  const signature = path.join(inputRoot, 'activation.sshsig')
  await writeFile(activation, '{}', { mode: 0o600 })
  await writeFile(signature, 'signature', { mode: 0o600 })
  const rewritten = await rewritePrivatePaths([
    '--activation-input',
    activation,
    '--activation-signature-input',
    signature
  ])
  assert.equal(rewritten.mounts.length, 1)
  await rewritten.revalidate()

  const unsafeRoot = await createPrivateRoot()
  await chmod(unsafeRoot, 0o755)
  await assert.rejects(
    rewritePrivatePaths([
      '--signature-payload-output',
      path.join(unsafeRoot, 'payload.json')
    ]),
    /CONTENT_PRIVATE_PATH_INVALID/
  )
})

test('removes a named container after an attached process failure', async () => {
  const calls = []
  const runCommand = async (args) => {
    calls.push(args)
    if (args[0] === 'create') {
      return {
        code: 0,
        stdout: Buffer.from('a'.repeat(64)),
        stderr: Buffer.alloc(0)
      }
    }
    if (args[0] === 'start') throw new Error('START_FAILED')
    return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  }

  await assert.rejects(
    runNamedContainer({
      containerName: 'fixture-container',
      createArgs: ['create', '--name', 'fixture-container', 'fixture-image'],
      startTimeoutMs: 1_000,
      runCommand,
      signalEmitter: new EventEmitter()
    }),
    /START_FAILED/
  )
  assert.ok(
    calls.some((args) => args.join(' ') === 'rm -f -v fixture-container')
  )
  assert.ok(calls.some((args) => args[0] === 'ps'))
})

test('cleans a named container before reporting an interrupt', async () => {
  const signalEmitter = new EventEmitter()
  const calls = []
  const runCommand = async (args) => {
    calls.push(args)
    if (args[0] === 'create') {
      return {
        code: 0,
        stdout: Buffer.from('b'.repeat(64)),
        stderr: Buffer.alloc(0)
      }
    }
    if (args[0] === 'start') signalEmitter.emit('SIGTERM')
    return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  }

  await assert.rejects(
    runNamedContainer({
      containerName: 'interrupted-container',
      createArgs: [
        'create',
        '--name',
        'interrupted-container',
        'fixture-image'
      ],
      startTimeoutMs: 1_000,
      runCommand,
      signalEmitter
    }),
    /CONTENT_RETAINED_RUNTIME_TIMEOUT/
  )
  assert.ok(
    calls.some((args) => args.join(' ') === 'rm -f -v interrupted-container')
  )
  assert.equal(signalEmitter.listenerCount('SIGTERM'), 0)
})

test('keeps checking after an uncertain create reports an initial absence', async () => {
  let processListChecks = 0
  let removalAttempts = 0
  const runCommand = async (args) => {
    if (args[0] === 'create') throw new Error('CREATE_TIMEOUT')
    if (args[0] === 'rm') removalAttempts += 1
    if (args[0] === 'ps') {
      processListChecks += 1
      return {
        code: 0,
        stdout: Buffer.from(processListChecks === 2 ? 'late-container' : ''),
        stderr: Buffer.alloc(0)
      }
    }
    return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  }

  await assert.rejects(
    runNamedContainer({
      containerName: 'late-container',
      createArgs: ['create', '--name', 'late-container', 'fixture-image'],
      startTimeoutMs: 1_000,
      runCommand,
      signalEmitter: new EventEmitter(),
      uncertainCleanupOptions: {
        maximumAttempts: 8,
        requiredConsecutiveAbsences: 3,
        delayMilliseconds: 0
      }
    }),
    /CREATE_TIMEOUT/
  )
  assert.ok(processListChecks >= 5)
  assert.ok(removalAttempts >= 5)
})
