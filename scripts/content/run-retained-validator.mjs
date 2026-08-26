import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024
const ROOT_FINGERPRINT =
  'c6f8c53384aa90de0ef57edac3398cea16f1ff48aec492b7b1df742cfbeb3467'
const DIGEST_PATTERN = /^[a-f0-9]{64}$/
const IMAGE_REPOSITORY_PATTERN =
  /^(?:[a-z0-9.-]+(?::[0-9]+)?\/)?[a-z0-9]+(?:[._/-][a-z0-9]+)*$/
const CHILD_FAILURE_EXITS = new Map([
  ['CONTENT_ARTIFACT_INVALID', 2],
  ['CONTENT_CERTIFICATE_INVALID', 2],
  ['CONTENT_EXACT_DUPLICATE', 2],
  ['CONTENT_DUPLICATE_DISPOSITION_REQUIRED', 2],
  ['CONTENT_COVERAGE_GATE_FAILED', 2],
  ['CONTENT_AUTH_REQUIRED', 3],
  ['CONTENT_AUTH_NOT_FRESH', 3],
  ['CONTENT_FORBIDDEN', 3],
  ['CONTENT_TARGET_MISMATCH', 3],
  ['CONTENT_PLAN_EXPIRED', 4],
  ['CONTENT_PLAN_HASH_MISMATCH', 4],
  ['CONTENT_RELEASE_HASH_MISMATCH', 4],
  ['CONTENT_BASE_VERSION_CONFLICT', 4],
  ['CONTENT_REQUIRES_NEW_QUESTION', 4],
  ['CONTENT_CATALOG_CHANGED', 4],
  ['CONTENT_DUPLICATE_CORPUS_CHANGED', 4],
  ['CONTENT_RELEASE_CHAIN_CHANGED', 4],
  ['CONTENT_SERIALIZATION_RETRY_EXHAUSTED', 5],
  ['CONTENT_REAUTH_RETRY_REQUIRED', 5],
  ['CONTENT_LOCK_TIMEOUT', 5],
  ['CONTENT_COMMAND_TIMEOUT', 5],
  ['CONTENT_INTERNAL_ERROR', 5]
])
const WRITABLE_REPOSITORY_COMMANDS = new Set([
  'legacy-policy-finalize',
  'legacy-policy-prepare',
  'policy-activation-finalize',
  'policy-finalize',
  'policy-prepare'
])
const PRIVATE_OUTPUT_FLAGS = new Set([
  '--activation-output',
  '--comparison-output',
  '--signature-payload-output'
])
const PRIVATE_INPUT_FLAGS = new Set([
  '--activation-input',
  '--activation-signature-input',
  '--catalog-snapshot',
  '--duplicate-corpus-snapshot',
  '--policy-signature-input',
  '--review-evidence'
])

const repositoryRoot = await realpath(
  fileURLToPath(new URL('../../', import.meta.url))
)
const isInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}
const dockerPath = await (async () => {
  for (const candidate of [
    '/opt/homebrew/bin/docker',
    '/usr/local/bin/docker',
    '/usr/bin/docker'
  ]) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  return null
})()

const fail = (ruleCode, exitCode = 5) => {
  process.stderr.write(
    `${JSON.stringify({ code: ruleCode, message: ruleCode, schemaVersion: 1 })}\n`
  )
  process.exitCode = exitCode
}

export const normalizeWrapperFailure = (error) => {
  const internal = error instanceof Error ? error.message : ''
  if (
    /^(?:CONTENT_PRIVATE_|POLICY_RUNTIME_MANIFEST_INVALID|CONTENT_COMMAND_UNKNOWN)/.test(
      internal
    )
  ) {
    return { code: 'CONTENT_ARTIFACT_INVALID', exitCode: 2 }
  }
  if (/^CONTENT_PROTECTED_RUNTIME_ANCHOR_/.test(internal)) {
    return { code: 'CONTENT_TARGET_MISMATCH', exitCode: 3 }
  }
  if (internal === 'CONTENT_RETAINED_RUNTIME_TIMEOUT') {
    return { code: 'CONTENT_COMMAND_TIMEOUT', exitCode: 5 }
  }
  return { code: 'CONTENT_INTERNAL_ERROR', exitCode: 5 }
}

const runDocker = async (
  args,
  { timeoutMs, captureStdout = false, captureStderr = false }
) =>
  new Promise((resolve, reject) => {
    if (dockerPath === null) {
      reject(new Error('CONTENT_RETAINED_RUNTIME_UNAVAILABLE'))
      return
    }
    const child = spawn(dockerPath, args, {
      env: {
        HOME: process.env.HOME ?? '/tmp',
        PATH: '/usr/local/bin:/usr/bin:/bin'
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    let outputBytes = 0
    let settled = false
    let abortError = null
    const requestAbort = (error) => {
      if (settled || abortError !== null) return
      abortError = error
      clearTimeout(timer)
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => {
      requestAbort(new Error('CONTENT_RETAINED_RUNTIME_TIMEOUT'))
    }, timeoutMs)
    const consume = (target) => (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
        requestAbort(new Error('CONTENT_RETAINED_RUNTIME_OUTPUT_OVERSIZED'))
        return
      }
      if (target !== null) target.push(Buffer.from(chunk))
    }
    child.stdout.on('data', consume(captureStdout ? stdout : null))
    child.stderr.on('data', consume(captureStderr ? stderr : null))
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('CONTENT_RETAINED_RUNTIME_UNAVAILABLE'))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (abortError !== null) {
        reject(abortError)
        return
      }
      resolve({
        code: code ?? 5,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr)
      })
    })
  })

export const cleanupNamedContainer = async (
  containerName,
  runCommand = runDocker,
  {
    maximumAttempts = 5,
    requiredConsecutiveAbsences = 1,
    delayMilliseconds = 250
  } = {}
) => {
  let consecutiveAbsences = 0
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    await runCommand(['rm', '-f', '-v', containerName], {
      timeoutMs: 30_000,
      captureStdout: true
    }).catch(() => null)
    const listed = await runCommand(
      [
        'ps',
        '-a',
        '--filter',
        `name=^/${containerName}$`,
        '--format',
        '{{.ID}}'
      ],
      { timeoutMs: 30_000, captureStdout: true }
    ).catch(() => null)
    if (
      listed !== null &&
      listed.code === 0 &&
      listed.stdout.toString('utf8').trim() === ''
    ) {
      consecutiveAbsences += 1
      if (consecutiveAbsences >= requiredConsecutiveAbsences) return true
    } else {
      consecutiveAbsences = 0
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, delayMilliseconds)
    )
  }
  return false
}

export const runNamedContainer = async ({
  containerName,
  createArgs,
  startTimeoutMs,
  runCommand = runDocker,
  signalEmitter = process,
  uncertainCleanupOptions = {
    maximumAttempts: 80,
    requiredConsecutiveAbsences: 20,
    delayMilliseconds: 250
  }
}) => {
  let interrupted = false
  let cleanupPromise
  const cleanup = () => {
    cleanupPromise ??= cleanupNamedContainer(containerName, runCommand).finally(
      () => {
        cleanupPromise = undefined
      }
    )
    return cleanupPromise
  }
  const handleSignal = () => {
    interrupted = true
    void cleanup()
  }
  const signals = ['SIGHUP', 'SIGINT', 'SIGTERM']
  for (const signal of signals) signalEmitter.on(signal, handleSignal)

  try {
    let created
    try {
      created = await runCommand(createArgs, {
        timeoutMs: 60_000,
        captureStdout: true
      })
    } catch (error) {
      await cleanup()
      if (
        !(await cleanupNamedContainer(
          containerName,
          runCommand,
          uncertainCleanupOptions
        ))
      ) {
        throw new Error('CONTENT_RETAINED_RUNTIME_CLEANUP_FAILED')
      }
      throw error
    }
    const containerId = created.stdout.toString('utf8').trim()
    if (
      created.code !== 0 ||
      !/^[a-f0-9]{64}$/.test(containerId) ||
      interrupted
    ) {
      if (!(await cleanup())) {
        throw new Error('CONTENT_RETAINED_RUNTIME_CLEANUP_FAILED')
      }
      if (
        (created.code !== 0 || !/^[a-f0-9]{64}$/.test(containerId)) &&
        !(await cleanupNamedContainer(
          containerName,
          runCommand,
          uncertainCleanupOptions
        ))
      ) {
        throw new Error('CONTENT_RETAINED_RUNTIME_CLEANUP_FAILED')
      }
      throw new Error(
        interrupted
          ? 'CONTENT_RETAINED_RUNTIME_TIMEOUT'
          : 'CONTENT_RETAINED_RUNTIME_CREATE_FAILED'
      )
    }

    let run
    let runError
    try {
      run = await runCommand(['start', '--attach', containerId], {
        timeoutMs: startTimeoutMs,
        captureStdout: true,
        captureStderr: true
      })
    } catch (error) {
      runError = error
    }
    if (!(await cleanup())) {
      throw new Error('CONTENT_RETAINED_RUNTIME_CLEANUP_FAILED')
    }
    if (interrupted) {
      throw new Error('CONTENT_RETAINED_RUNTIME_TIMEOUT')
    }
    if (runError !== undefined) throw runError
    if (run === undefined) {
      throw new Error('CONTENT_RETAINED_RUNTIME_FAILED')
    }
    return run
  } finally {
    for (const signal of signals) signalEmitter.off(signal, handleSignal)
  }
}

const parseRuntimeManifest = async () => {
  const manifestPath = path.join(
    repositoryRoot,
    'content/runtime/validator-runtime-manifest.v1.json'
  )
  const before = await lstat(manifestPath, { bigint: true })
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (before.mode & 0o22n) !== 0n ||
    before.size < 1n ||
    before.size > 1024n * 1024n ||
    (await realpath(manifestPath)) !== manifestPath
  ) {
    throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
  }
  const handle = await open(
    manifestPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  let bytes
  try {
    const opened = await handle.stat({ bigint: true })
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
    }
    bytes = Buffer.alloc(Number(opened.size))
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset
      )
      if (bytesRead === 0) {
        throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
      }
      offset += bytesRead
    }
    const extra = Buffer.alloc(1)
    if ((await handle.read(extra, 0, 1, bytes.length)).bytesRead !== 0) {
      throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
    }
    const after = await handle.stat({ bigint: true })
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    ) {
      throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
    }
  } finally {
    await handle.close()
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
  }
  let source
  try {
    source = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true
    }).decode(bytes)
  } catch {
    throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
  }
  let value
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
  }
  if (canonicalJsonText(value) !== source) {
    throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('runtimeImageIndexSha256' in value) ||
    typeof value.runtimeImageIndexSha256 !== 'string' ||
    !DIGEST_PATTERN.test(value.runtimeImageIndexSha256) ||
    !('postgresImageSha256' in value) ||
    typeof value.postgresImageSha256 !== 'string' ||
    !DIGEST_PATTERN.test(value.postgresImageSha256)
  ) {
    throw new Error('POLICY_RUNTIME_MANIFEST_INVALID')
  }
  return value
}

export const rewritePrivatePaths = async (args) => {
  const rewritten = [...args]
  const requests = []
  for (let index = 0; index < rewritten.length; index += 2) {
    const flag = rewritten[index]
    const value = rewritten[index + 1]
    const isOutput = PRIVATE_OUTPUT_FLAGS.has(flag)
    if (!isOutput && !PRIVATE_INPUT_FLAGS.has(flag)) continue
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
      throw new Error('CONTENT_PRIVATE_PATH_INVALID')
    }
    const normalizedValue = path.normalize(value)
    const lexicalParent = path.dirname(normalizedValue)
    const parent = await realpath(lexicalParent)
    const fileName = path.basename(normalizedValue)
    if (normalizedValue !== value || parent !== lexicalParent) {
      throw new Error('CONTENT_PRIVATE_PATH_INVALID')
    }
    const parentMetadata = await lstat(parent, { bigint: true })
    if (
      !parentMetadata.isDirectory() ||
      parentMetadata.isSymbolicLink() ||
      (parentMetadata.mode & 0o777n) !== 0o700n ||
      (typeof process.getuid === 'function' &&
        parentMetadata.uid !== BigInt(process.getuid()))
    ) {
      throw new Error('CONTENT_PRIVATE_PATH_INVALID')
    }
    const canonicalCandidate = isOutput
      ? path.join(parent, fileName)
      : await realpath(value)
    if (isInside(repositoryRoot, canonicalCandidate)) {
      throw new Error('CONTENT_PRIVATE_PATH_INVALID')
    }
    if (isOutput) {
      await access(parent, constants.W_OK)
      try {
        await lstat(canonicalCandidate, { bigint: true })
        throw new Error('CONTENT_PRIVATE_PATH_INVALID')
      } catch (error) {
        if (
          !(
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        ) {
          throw error
        }
      }
    } else {
      await access(value, constants.R_OK)
      const fileMetadata = await lstat(value, { bigint: true })
      if (
        canonicalCandidate !== normalizedValue ||
        !fileMetadata.isFile() ||
        fileMetadata.isSymbolicLink() ||
        (fileMetadata.mode & 0o777n) !== 0o600n
      ) {
        throw new Error('CONTENT_PRIVATE_PATH_INVALID')
      }
      requests.push({
        index: index + 1,
        isOutput,
        parent,
        fileName,
        parentMetadata,
        fileMetadata
      })
      continue
    }
    requests.push({
      index: index + 1,
      isOutput,
      parent,
      fileName,
      parentMetadata
    })
  }

  const mounts = []
  const inputGroups = new Map()
  const outputGroups = new Map()
  for (const request of requests) {
    const groups = request.isOutput ? outputGroups : inputGroups
    const names = groups.get(request.parent) ?? new Set()
    if (names.has(request.fileName)) {
      throw new Error('CONTENT_PRIVATE_PATH_INVALID')
    }
    names.add(request.fileName)
    groups.set(request.parent, names)
  }
  for (const parent of outputGroups.keys()) {
    if (inputGroups.has(parent)) {
      throw new Error('CONTENT_PRIVATE_PATH_INVALID')
    }
  }
  for (const [parent, allowedNames] of inputGroups) {
    const entries = await readdir(parent, { withFileTypes: true })
    if (
      entries.length !== allowedNames.size ||
      entries.some((entry) => !entry.isFile() || !allowedNames.has(entry.name))
    ) {
      throw new Error('CONTENT_PRIVATE_INPUT_DIRECTORY_NOT_ISOLATED')
    }
    const containerParent = `/private-artifacts/input-${mounts.length}`
    mounts.push({ source: parent, target: containerParent, readOnly: true })
    for (const request of requests) {
      if (!request.isOutput && request.parent === parent) {
        rewritten[request.index] = `${containerParent}/${request.fileName}`
      }
    }
  }
  for (const [parent] of outputGroups) {
    if ((await readdir(parent)).length !== 0) {
      throw new Error('CONTENT_PRIVATE_OUTPUT_DIRECTORY_NOT_EMPTY')
    }
    const containerParent = `/private-artifacts/output-${mounts.length}`
    mounts.push({
      source: parent,
      target: containerParent,
      readOnly: false
    })
    for (const request of requests) {
      if (request.isOutput && request.parent === parent) {
        rewritten[request.index] = `${containerParent}/${request.fileName}`
      }
    }
  }
  const revalidate = async () => {
    for (const request of requests) {
      const parentMetadata = await lstat(request.parent, { bigint: true })
      if (
        parentMetadata.dev !== request.parentMetadata.dev ||
        parentMetadata.ino !== request.parentMetadata.ino ||
        parentMetadata.ctimeNs !== request.parentMetadata.ctimeNs ||
        (parentMetadata.mode & 0o777n) !== 0o700n
      ) {
        throw new Error('CONTENT_PRIVATE_PATH_CHANGED')
      }
      const candidate = path.join(request.parent, request.fileName)
      if (request.isOutput) {
        try {
          await lstat(candidate, { bigint: true })
          throw new Error('CONTENT_PRIVATE_PATH_CHANGED')
        } catch (error) {
          if (
            !(
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'ENOENT'
            )
          ) {
            throw error
          }
        }
      } else {
        const fileMetadata = await lstat(candidate, { bigint: true })
        if (
          fileMetadata.dev !== request.fileMetadata.dev ||
          fileMetadata.ino !== request.fileMetadata.ino ||
          fileMetadata.size !== request.fileMetadata.size ||
          fileMetadata.ctimeNs !== request.fileMetadata.ctimeNs ||
          (fileMetadata.mode & 0o777n) !== 0o600n
        ) {
          throw new Error('CONTENT_PRIVATE_PATH_CHANGED')
        }
      }
    }
  }
  return { args: rewritten, mounts, revalidate }
}

export const canonicalJsonText = (value) => {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonText).join(',')}]`
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
    }
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonText(value[key])}`)
      .join(',')}}`
  }
  throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
}

const SUCCESS_FIELDS = new Map([
  [
    'policy-prepare',
    [
      'command',
      'policySnapshotSha256',
      'schemaVersion',
      'sourceFileCount',
      'status'
    ]
  ],
  [
    'check',
    [
      'command',
      'legacyItemCount',
      'policySnapshotSha256',
      'schemaVersion',
      'status',
      'trackedPolicySnapshotCount',
      'validatorSourceCount'
    ]
  ],
  [
    'legacy-policy-prepare',
    [
      'command',
      'legacyItemCount',
      'policySnapshotSha256',
      'schemaVersion',
      'status',
      'validatorSourceCount'
    ]
  ],
  [
    'legacy-policy-finalize',
    ['command', 'policySnapshotSha256', 'schemaVersion', 'status']
  ],
  [
    'policy-finalize',
    ['command', 'policySnapshotSha256', 'schemaVersion', 'status']
  ],
  [
    'policy-activation-prepare',
    [
      'activationRevision',
      'activationSha256',
      'command',
      'policySnapshotSha256',
      'schemaVersion',
      'status'
    ]
  ],
  [
    'policy-activation-finalize',
    [
      'activationRevision',
      'activationSha256',
      'command',
      'policySnapshotSha256',
      'schemaVersion',
      'status'
    ]
  ],
  [
    'author-prepare',
    ['bundleSha256', 'command', 'itemCount', 'schemaVersion', 'status']
  ],
  [
    'validate',
    ['bundleSha256', 'command', 'itemCount', 'schemaVersion', 'status']
  ],
  [
    'coverage',
    ['bundleSha256', 'command', 'coverage', 'schemaVersion', 'status']
  ],
  [
    'duplicates',
    [
      'bundleSha256',
      'command',
      'exactDuplicateCount',
      'schemaVersion',
      'status',
      'warningCount',
      'warnings'
    ]
  ],
  [
    'review-prepare',
    [
      'bundleSha256',
      'certificateSha256',
      'command',
      'comparisonSha256',
      'itemCount',
      'reviewEvidenceSha256',
      'schemaVersion',
      'status'
    ]
  ],
  [
    'review-check',
    [
      'bundleSha256',
      'certificateSha256',
      'command',
      'itemCount',
      'schemaVersion',
      'status'
    ]
  ]
])

const exactKeys = (value, expected) => {
  const actual = Object.keys(value).toSorted()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

const COVERAGE_LEVEL_VALUES = ['N5', 'N4', 'N3', 'N2', 'N1']
const COVERAGE_SUBJECT_VALUES = ['VOCABULARY', 'GRAMMAR', 'READING']
const COVERAGE_QUESTION_TYPE_VALUES = [
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
const COVERAGE_DIFFICULTY_VALUES = ['EASY', 'NORMAL', 'HARD']
const QUESTION_TYPES_BY_SUBJECT = {
  VOCABULARY: new Set([
    'KANJI_READING',
    'ORTHOGRAPHY',
    'CONTEXT_VOCABULARY',
    'PARAPHRASE',
    'WORD_USAGE'
  ]),
  GRAMMAR: new Set(['GRAMMAR_SELECT', 'SENTENCE_ORDER', 'TEXT_GRAMMAR']),
  READING: new Set([
    'SHORT_READING',
    'MEDIUM_READING',
    'LONG_READING',
    'INFO_RETRIEVAL'
  ])
}
const READING_TYPES_BY_LEVEL = {
  N5: new Set(['SHORT_READING', 'INFO_RETRIEVAL']),
  N4: new Set(['SHORT_READING', 'INFO_RETRIEVAL']),
  N3: new Set(['SHORT_READING', 'MEDIUM_READING', 'INFO_RETRIEVAL']),
  N2: new Set(['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL']),
  N1: new Set(['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL'])
}
const EXPECTED_VALIDATOR_SOURCE_COUNT_V1 = 47
const EXPECTED_LEGACY_VALIDATOR_SOURCE_COUNT_V1 = 9
const EXPECTED_LEGACY_ITEM_COUNT_V1 = 65

const assertSafeCoverage = (coverage) => {
  if (
    typeof coverage !== 'object' ||
    coverage === null ||
    !exactKeys(coverage, [
      'byLevelSubject',
      'byLevelSubjectDifficulty',
      'byLevelSubjectType',
      'itemCount',
      'schemaVersion',
      'scope'
    ]) ||
    coverage.schemaVersion !== 1 ||
    coverage.scope !== 'BUNDLE_ONLY' ||
    !Number.isSafeInteger(coverage.itemCount) ||
    coverage.itemCount < 0
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  const levelSubjectRows = coverage.byLevelSubject
  const typeRows = coverage.byLevelSubjectType
  const difficultyRows = coverage.byLevelSubjectDifficulty
  const expectedLevelSubjectRows = COVERAGE_LEVEL_VALUES.flatMap((level) =>
    COVERAGE_SUBJECT_VALUES.map((subject) => ({ level, subject }))
  )
  const expectedTypeRows = COVERAGE_LEVEL_VALUES.flatMap((level) =>
    COVERAGE_SUBJECT_VALUES.flatMap((subject) =>
      COVERAGE_QUESTION_TYPE_VALUES.map((questionType) => ({
        level,
        subject,
        questionType
      }))
    )
  )
  const expectedDifficultyRows = COVERAGE_LEVEL_VALUES.flatMap((level) =>
    COVERAGE_SUBJECT_VALUES.flatMap((subject) =>
      COVERAGE_DIFFICULTY_VALUES.map((difficulty) => ({
        level,
        subject,
        difficulty
      }))
    )
  )
  if (
    !Array.isArray(levelSubjectRows) ||
    levelSubjectRows.length !== expectedLevelSubjectRows.length ||
    levelSubjectRows.some((row, index) => {
      const expected = expectedLevelSubjectRows[index]
      return (
        typeof row !== 'object' ||
        row === null ||
        expected === undefined ||
        !exactKeys(row, ['count', 'level', 'subject']) ||
        row.level !== expected.level ||
        row.subject !== expected.subject ||
        !Number.isSafeInteger(row.count) ||
        row.count < 0
      )
    }) ||
    !Array.isArray(typeRows) ||
    typeRows.length !== expectedTypeRows.length ||
    typeRows.some((row, index) => {
      const expected = expectedTypeRows[index]
      if (
        typeof row !== 'object' ||
        row === null ||
        expected === undefined ||
        !exactKeys(row, [
          'applicable',
          'count',
          'level',
          'questionType',
          'subject'
        ]) ||
        row.level !== expected.level ||
        row.subject !== expected.subject ||
        row.questionType !== expected.questionType ||
        typeof row.applicable !== 'boolean' ||
        !Number.isSafeInteger(row.count) ||
        row.count < 0
      ) {
        return true
      }
      const subjectAllows = QUESTION_TYPES_BY_SUBJECT[row.subject].has(
        row.questionType
      )
      const expectedApplicable =
        subjectAllows &&
        (row.subject !== 'READING' ||
          READING_TYPES_BY_LEVEL[row.level].has(row.questionType))
      return (
        row.applicable !== expectedApplicable ||
        (!row.applicable && row.count !== 0)
      )
    }) ||
    !Array.isArray(difficultyRows) ||
    difficultyRows.length !== expectedDifficultyRows.length ||
    difficultyRows.some((row, index) => {
      const expected = expectedDifficultyRows[index]
      return (
        typeof row !== 'object' ||
        row === null ||
        expected === undefined ||
        !exactKeys(row, ['count', 'difficulty', 'level', 'subject']) ||
        row.level !== expected.level ||
        row.subject !== expected.subject ||
        row.difficulty !== expected.difficulty ||
        !Number.isSafeInteger(row.count) ||
        row.count < 0
      )
    }) ||
    levelSubjectRows.reduce((sum, row) => sum + row.count, 0) !==
      coverage.itemCount ||
    typeRows.reduce((sum, row) => sum + row.count, 0) !== coverage.itemCount ||
    difficultyRows.reduce((sum, row) => sum + row.count, 0) !==
      coverage.itemCount
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
}

const assertSafeSuccess = (parsed, command) => {
  const expectedFields = SUCCESS_FIELDS.get(command)
  const expectedStatus =
    command === 'review-prepare'
      ? new Set(['PASS', 'REVIEW_REQUIRED'])
      : new Set(['PASS'])
  if (
    expectedFields === undefined ||
    !exactKeys(parsed, expectedFields) ||
    !expectedStatus.has(parsed.status)
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (key.endsWith('Sha256')) {
      if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
        throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
      }
    } else if (
      key.endsWith('Count') ||
      key === 'activationRevision' ||
      key === 'sourceFileCount'
    ) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
      }
    }
  }
  if ('coverage' in parsed) assertSafeCoverage(parsed.coverage)
  if (
    'warnings' in parsed &&
    (!Array.isArray(parsed.warnings) || parsed.warnings.length !== 0)
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  if (
    command === 'duplicates' &&
    (parsed.exactDuplicateCount !== 0 || parsed.warningCount !== 0)
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  if (
    command === 'coverage' &&
    (parsed.coverage.itemCount < 1 || parsed.coverage.itemCount > 25)
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  if (
    (command === 'author-prepare' ||
      command === 'validate' ||
      command === 'review-prepare' ||
      command === 'review-check') &&
    (parsed.itemCount < 1 || parsed.itemCount > 25)
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  if (
    (command === 'policy-activation-prepare' ||
      command === 'policy-activation-finalize') &&
    parsed.activationRevision < 1
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  if (
    command === 'policy-prepare' &&
    parsed.sourceFileCount !== EXPECTED_VALIDATOR_SOURCE_COUNT_V1
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  if (
    command === 'legacy-policy-prepare' &&
    (parsed.legacyItemCount !== EXPECTED_LEGACY_ITEM_COUNT_V1 ||
      parsed.validatorSourceCount !== EXPECTED_LEGACY_VALIDATOR_SOURCE_COUNT_V1)
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  if (
    command === 'check' &&
    (parsed.legacyItemCount !== EXPECTED_LEGACY_ITEM_COUNT_V1 ||
      parsed.validatorSourceCount !== EXPECTED_VALIDATOR_SOURCE_COUNT_V1 ||
      parsed.trackedPolicySnapshotCount < 2)
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
}

export const validateChildResult = (run, command) => {
  if (run.code === 0) {
    const text = run.stdout.toString('utf8')
    if (
      run.stderr.byteLength !== 0 ||
      !text.endsWith('\n') ||
      text.slice(0, -1).includes('\n')
    ) {
      throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.schemaVersion !== 1 ||
      parsed.command !== `content:${command}` ||
      `${canonicalJsonText(parsed)}\n` !== text
    ) {
      throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
    }
    assertSafeSuccess(parsed, command)
    return { stdout: Buffer.from(text), stderr: Buffer.alloc(0), exitCode: 0 }
  }

  const text = run.stderr.toString('utf8')
  let parsed
  try {
    if (
      run.stdout.byteLength !== 0 ||
      !text.endsWith('\n') ||
      text.slice(0, -1).includes('\n')
    ) {
      throw new Error('INVALID')
    }
    parsed = JSON.parse(text)
    const expected = {
      code: parsed.code,
      message: parsed.message,
      schemaVersion: parsed.schemaVersion
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.schemaVersion !== 1 ||
      typeof parsed.code !== 'string' ||
      parsed.message !== parsed.code ||
      Object.keys(parsed).length !== 3 ||
      CHILD_FAILURE_EXITS.get(parsed.code) !== run.code ||
      `${canonicalJsonText(expected)}\n` !== text
    ) {
      throw new Error('INVALID')
    }
  } catch {
    throw new Error('CONTENT_RETAINED_RUNTIME_PROTOCOL_INVALID')
  }
  return {
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(text, 'utf8'),
    exitCode: run.code
  }
}

const main = async () => {
  const [command, ...rawArgs] = process.argv.slice(2)
  if (command === undefined || !/^[a-z][a-z0-9-]{1,63}$/.test(command)) {
    throw new Error('CONTENT_COMMAND_UNKNOWN')
  }
  const expectedRuntimeDigest =
    process.env.CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256
  const expectedPostgresDigest = process.env.CONTENT_POSTGRES_IMAGE_SHA256
  const imageRepository = process.env.CONTENT_VALIDATOR_IMAGE_REPOSITORY
  const postgresImageRepository = process.env.CONTENT_POSTGRES_IMAGE_REPOSITORY
  const rootFingerprint = process.env.CONTENT_POLICY_ROOT_FINGERPRINT_SHA256
  if (
    expectedRuntimeDigest === undefined ||
    !DIGEST_PATTERN.test(expectedRuntimeDigest) ||
    expectedPostgresDigest === undefined ||
    !DIGEST_PATTERN.test(expectedPostgresDigest) ||
    imageRepository === undefined ||
    !IMAGE_REPOSITORY_PATTERN.test(imageRepository) ||
    postgresImageRepository === undefined ||
    !IMAGE_REPOSITORY_PATTERN.test(postgresImageRepository) ||
    rootFingerprint !== ROOT_FINGERPRINT
  ) {
    throw new Error('CONTENT_PROTECTED_RUNTIME_ANCHOR_MISSING')
  }

  if (command === 'policy-prepare') {
    const runtimeIndex = rawArgs.indexOf('--runtime-image-index-sha256')
    const postgresIndex = rawArgs.indexOf('--postgres-image-sha256')
    if (
      runtimeIndex < 0 ||
      rawArgs[runtimeIndex + 1] !== expectedRuntimeDigest ||
      postgresIndex < 0 ||
      rawArgs[postgresIndex + 1] !== expectedPostgresDigest
    ) {
      throw new Error('CONTENT_PROTECTED_RUNTIME_ANCHOR_MISMATCH')
    }
  } else {
    const runtimeManifest = await parseRuntimeManifest()
    if (
      runtimeManifest.runtimeImageIndexSha256 !== expectedRuntimeDigest ||
      runtimeManifest.postgresImageSha256 !== expectedPostgresDigest
    ) {
      throw new Error('CONTENT_PROTECTED_RUNTIME_ANCHOR_MISMATCH')
    }
  }

  const privatePaths = await rewritePrivatePaths(rawArgs)
  const imageReference = `${imageRepository}@sha256:${expectedRuntimeDigest}`
  const postgresImageReference = `${postgresImageRepository}@sha256:${expectedPostgresDigest}`
  const pull = await runDocker(['pull', imageReference], {
    timeoutMs: 5 * 60_000
  })
  if (pull.code !== 0) throw new Error('CONTENT_RETAINED_RUNTIME_PULL_FAILED')
  const postgresPull = await runDocker(['pull', postgresImageReference], {
    timeoutMs: 5 * 60_000
  })
  if (postgresPull.code !== 0) {
    throw new Error('CONTENT_POSTGRES_RUNTIME_PULL_FAILED')
  }
  const inspect = await runDocker(
    ['image', 'inspect', imageReference, '--format', '{{json .RepoDigests}}'],
    { timeoutMs: 30_000, captureStdout: true }
  )
  if (
    inspect.code !== 0 ||
    !inspect.stdout
      .toString('utf8')
      .includes(`@sha256:${expectedRuntimeDigest}`)
  ) {
    throw new Error('CONTENT_RETAINED_RUNTIME_DIGEST_MISMATCH')
  }
  const postgresInspect = await runDocker(
    [
      'image',
      'inspect',
      postgresImageReference,
      '--format',
      '{{json .RepoDigests}}'
    ],
    { timeoutMs: 30_000, captureStdout: true }
  )
  if (
    postgresInspect.code !== 0 ||
    !postgresInspect.stdout
      .toString('utf8')
      .includes(`@sha256:${expectedPostgresDigest}`)
  ) {
    throw new Error('CONTENT_POSTGRES_RUNTIME_DIGEST_MISMATCH')
  }
  const postgresProbeName = `nihongo-postgres-probe-${process.pid}-${randomBytes(8).toString('hex')}`
  const postgresVersion = await runNamedContainer({
    containerName: postgresProbeName,
    createArgs: [
      'create',
      '--name',
      postgresProbeName,
      '--network',
      'none',
      '--read-only',
      '--user',
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--tmpfs',
      '/var/lib/postgresql:rw,noexec,nosuid,nodev,size=1m',
      '--entrypoint',
      'postgres',
      postgresImageReference,
      '--version'
    ],
    startTimeoutMs: 30_000
  })
  if (
    postgresVersion.code !== 0 ||
    postgresVersion.stderr.byteLength !== 0 ||
    postgresVersion.stdout.toString('utf8').trim() !==
      'postgres (PostgreSQL) 18.4'
  ) {
    throw new Error('CONTENT_POSTGRES_RUNTIME_VERSION_MISMATCH')
  }

  const repositoryReadOnly = !WRITABLE_REPOSITORY_COMMANDS.has(command)
  const containerName = `nihongo-content-${process.pid}-${randomBytes(8).toString('hex')}`
  const createArgs = [
    'create',
    '--name',
    containerName,
    '--network',
    'none',
    '--read-only',
    '--user',
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=64m',
    '--mount',
    `type=bind,src=${repositoryRoot},dst=/workspace${repositoryReadOnly ? ',readonly' : ''}`,
    '--env',
    'CONTENT_RETAINED_RUNTIME=1',
    '--env',
    'HOME=/tmp',
    '--env',
    'CONTENT_REPOSITORY_ROOT=/workspace',
    '--env',
    `CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256=${expectedRuntimeDigest}`,
    '--env',
    `CONTENT_POSTGRES_IMAGE_SHA256=${expectedPostgresDigest}`,
    '--env',
    `CONTENT_POLICY_ROOT_FINGERPRINT_SHA256=${rootFingerprint}`
  ]
  for (const name of [
    'CONTENT_POLICY_TERMINAL_REVISION',
    'CONTENT_POLICY_TERMINAL_SHA256'
  ]) {
    const value = process.env[name]
    if (value !== undefined) createArgs.push('--env', `${name}=${value}`)
  }
  for (const mount of privatePaths.mounts) {
    createArgs.push(
      '--mount',
      `type=bind,src=${mount.source},dst=${mount.target}${mount.readOnly ? ',readonly' : ''}`
    )
  }
  await privatePaths.revalidate()
  createArgs.push(imageReference, command, ...privatePaths.args)
  const run = await runNamedContainer({
    containerName,
    createArgs,
    startTimeoutMs: 10 * 60_000
  })
  const validated = validateChildResult(run, command)
  if (validated.stdout.byteLength > 0) process.stdout.write(validated.stdout)
  if (validated.stderr.byteLength > 0) process.stderr.write(validated.stderr)
  process.exitCode = validated.exitCode
}

const invokedPath = process.argv[1]
const invokedDirectly =
  invokedPath !== undefined &&
  (await realpath(invokedPath).catch(() => '')) ===
    (await realpath(fileURLToPath(import.meta.url)))

if (invokedDirectly) {
  main().catch((error) => {
    const failure = normalizeWrapperFailure(error)
    fail(failure.code, failure.exitCode)
  })
}
