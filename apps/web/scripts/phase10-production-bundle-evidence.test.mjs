import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  assertPhase10BundleEvidence,
  assertPhase10BundleEvidenceProvenance
} from './phase10-production-bundle-contract.mjs'
import { writeCanonicalBundleEvidence } from './phase10-production-bundle-evidence-files.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(webRoot, '../..')
const evidenceDirectory = path.resolve(
  process.env.PHASE10_PERFORMANCE_EVIDENCE_DIR ??
    path.join(repositoryRoot, 'test-results/phase10-evidence/performance')
)
const evidence = JSON.parse(
  await readFile(path.join(evidenceDirectory, 'bundle.json'), 'utf8')
)

const expectRejected = (mutate) => {
  const candidate = JSON.parse(JSON.stringify(evidence))
  mutate(candidate)
  assert.throws(() => assertPhase10BundleEvidence(candidate), /PHASE10_/u)
}

const readJsonFileWhenReady = async (filePath, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'))
    } catch (error) {
      if (!(error instanceof Error) || error.code !== 'ENOENT') throw error
      await delay(20)
    }
  }
  throw new Error(`Timed out waiting for ${filePath}.`)
}

const isProcessRunning = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && error.code === 'ESRCH') return false
    throw error
  }
}

const waitForProcessesToStop = async (pids, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs
  let running = pids.filter(isProcessRunning)
  while (running.length > 0 && Date.now() < deadline) {
    await delay(20)
    running = running.filter(isProcessRunning)
  }
  assert.deepEqual(running, [])
}

const listBundleTemporaryDirectories = async () =>
  new Set(
    (await readdir(tmpdir())).filter((name) =>
      name.startsWith('nihongo-phase10-bundle-')
    )
  )

const runHangingBundleBuild = async ({ sendSignal }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase10-bundle-hang-'))
  const evidenceDirectory = path.join(directory, 'evidence')
  const pidFile = path.join(directory, 'pids.json')
  const shimDirectory = path.join(directory, 'bin')
  const pnpmShim = path.join(shimDirectory, 'pnpm')
  const temporaryDirectoriesBefore = await listBundleTemporaryDirectories()
  await mkdir(shimDirectory)
  await writeFile(
    pnpmShim,
    `#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
process.on('SIGTERM', () => {})
const nested = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' })
writeFileSync(process.env.PHASE10_BUNDLE_TEST_PID_FILE, JSON.stringify({ leaderPid: process.pid, nestedPid: nested.pid }))
setInterval(() => {}, 1000)
`,
    'utf8'
  )
  await chmod(pnpmShim, 0o700)

  let runner
  let ownedPids = []
  try {
    const resultPromise = new Promise((resolve, reject) => {
      runner = spawn(
        process.execPath,
        ['scripts/phase10-production-bundle-check.mjs'],
        {
          cwd: webRoot,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            PATH: `${shimDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
            PHASE10_BUNDLE_TEST_COMMAND_TIMEOUT_MS: sendSignal
              ? '5000'
              : '2000',
            PHASE10_BUNDLE_TEST_FORCE_KILL_TIMEOUT_MS: '1000',
            PHASE10_BUNDLE_TEST_GRACEFUL_TIMEOUT_MS: '100',
            PHASE10_BUNDLE_TEST_PID_FILE: pidFile,
            PHASE10_PERFORMANCE_EVIDENCE_DIR: evidenceDirectory
          },
          stdio: ['ignore', 'ignore', 'pipe']
        }
      )
      let stderr = ''
      runner.stderr.setEncoding('utf8')
      runner.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      runner.once('error', reject)
      runner.once('close', (code, signal) => {
        resolve({ code, signal, stderr })
      })
    })
    const { leaderPid, nestedPid } = await readJsonFileWhenReady(pidFile)
    ownedPids = [leaderPid, nestedPid]
    if (sendSignal) runner.kill('SIGTERM')
    const result = await Promise.race([
      resultPromise,
      delay(10_000).then(() => {
        throw new Error('Phase 10 hanging bundle runner did not stop.')
      })
    ])
    await waitForProcessesToStop(ownedPids)
    await assert.rejects(() =>
      access(path.join(evidenceDirectory, 'bundle.json'))
    )
    const temporaryDirectoriesAfter = await listBundleTemporaryDirectories()
    assert.deepEqual(
      [...temporaryDirectoriesAfter].filter(
        (name) => !temporaryDirectoriesBefore.has(name)
      ),
      []
    )
    return result
  } finally {
    if (runner && runner.exitCode === null && runner.signalCode === null) {
      runner.kill('SIGKILL')
    }
    for (const pid of ownedPids) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch (error) {
        assert.ok(error instanceof Error && error.code === 'ESRCH')
      }
    }
    await rm(directory, { force: true, recursive: true })
  }
}

test('accepts the freshly generated closed-schema bundle evidence', async () => {
  assert.doesNotThrow(() => assertPhase10BundleEvidence(evidence))
  assert.equal(
    evidence.metadata.command,
    'pnpm exec vite build --manifest .vite/phase10-manifest.json --ssrManifest .vite/phase10-ssr-manifest.json --outDir <temporary-out-dir> --emptyOutDir'
  )
  assert.doesNotMatch(evidence.metadata.command, /nihongo-phase10-bundle-/u)
  await assert.doesNotReject(() =>
    assertPhase10BundleEvidenceProvenance({ evidence, repositoryRoot })
  )
})

test('rejects inaccurate build command and environment provenance', () => {
  expectRejected((candidate) => {
    candidate.metadata.command = candidate.metadata.command.replace(
      ' --emptyOutDir',
      ''
    )
  })
  expectRejected((candidate) => {
    candidate.metadata.command = candidate.metadata.command.replace(
      '<temporary-out-dir>',
      '/tmp/nihongo-phase10-bundle-forged'
    )
  })
  expectRejected((candidate) => {
    candidate.metadata.environment.apiMode = 'mock'
  })
})

test('rejects forged budget, measurement, and accepted digest fields', () => {
  const metric = 'totalRawBytes'
  expectRejected((candidate) => {
    candidate.measurements[metric] = candidate.budgets[metric].ceiling + 1
    candidate.budgets[metric].actual = candidate.measurements[metric]
    candidate.budgets[metric].delta =
      candidate.measurements[metric] - candidate.budgets[metric].baseline
    candidate.budgets[metric].ratio =
      candidate.measurements[metric] / candidate.budgets[metric].baseline
    candidate.budgets[metric].passed = true
  })
  expectRejected((candidate) => {
    candidate.budgets[metric].delta += 1
  })
  expectRejected((candidate) => {
    candidate.inventory.acceptedBaselineSha256 = '0'.repeat(64)
  })
  expectRejected((candidate) => {
    candidate.inventory.matchesAcceptedBaseline =
      !candidate.inventory.matchesAcceptedBaseline
  })
})

test('rejects incomplete graph, boundary, largest asset, and metadata rows', () => {
  expectRejected((candidate) => {
    candidate.graph[0] = {}
  })
  expectRejected((candidate) => {
    candidate.boundaries.admin[0] = {}
  })
  expectRejected((candidate) => {
    candidate.largestAssets = {}
  })
  expectRejected((candidate) => {
    candidate.metadata.credential = 'must-not-be-recorded'
  })
})

test('rejects duplicate inventory paths and forbidden transitive modules', () => {
  expectRejected((candidate) => {
    candidate.inventory.rows[1].path = candidate.inventory.rows[0].path
  })
  expectRejected((candidate) => {
    candidate.modules.rows.push({ assets: [], source: 'src/mocks/service.ts' })
    candidate.modules.rows.sort((left, right) =>
      left.source.localeCompare(right.source)
    )
    candidate.modules.count = candidate.modules.rows.length
    candidate.modules.sha256 = createHash('sha256')
      .update(JSON.stringify(candidate.modules.rows))
      .digest('hex')
  })
  for (const source of [
    '../../node_modules/.pnpm/vitest@4.1.11/node_modules/vitest/dist/index.js',
    '../../node_modules/.pnpm/@testing-library+react@16.0.0/node_modules/@testing-library/react/dist/index.js',
    '../../node_modules/.pnpm/jsdom@26.0.0/node_modules/jsdom/lib/api.js',
    '../../node_modules/.pnpm/msw@2.0.0/node_modules/msw/lib/core/index.mjs',
    '../../node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/index.mjs',
    '../../node_modules/.pnpm/@axe-core+playwright@4.13.0/node_modules/@axe-core/playwright/dist/index.js'
  ]) {
    expectRejected((candidate) => {
      candidate.modules.rows.push({ assets: [], source })
      candidate.modules.rows.sort((left, right) =>
        left.source.localeCompare(right.source)
      )
      candidate.modules.count = candidate.modules.rows.length
      candidate.modules.sha256 = createHash('sha256')
        .update(JSON.stringify(candidate.modules.rows))
        .digest('hex')
    })
  }
})

test('rejects forged payload content, SSR assets, and orphan client nodes', () => {
  expectRejected((candidate) => {
    candidate.inventory.rows[0].contentSha256 = '0'.repeat(64)
  })
  expectRejected((candidate) => {
    candidate.modules.rows[0].assets.push('/assets/not-emitted.js')
    candidate.modules.rows[0].assets.sort()
    candidate.modules.sha256 = createHash('sha256')
      .update(JSON.stringify(candidate.modules.rows))
      .digest('hex')
  })
  expectRejected((candidate) => {
    const row = candidate.modules.rows.find(({ assets }) => assets.length > 0)
    assert.ok(row)
    row.assets.pop()
    candidate.modules.sha256 = createHash('sha256')
      .update(JSON.stringify(candidate.modules.rows))
      .digest('hex')
  })
  expectRejected((candidate) => {
    const incoming = new Map(candidate.graph.map(({ source }) => [source, 0]))
    for (const entry of candidate.graph) {
      for (const reference of [...entry.imports, ...entry.dynamicImports]) {
        incoming.set(reference, (incoming.get(reference) ?? 0) + 1)
      }
    }
    const orphanSource = candidate.graph.find(
      ({ source }) => source !== 'index.html' && incoming.get(source) === 1
    )?.source
    assert.ok(orphanSource)
    const parent = candidate.graph.find(
      ({ imports, dynamicImports }) =>
        imports.includes(orphanSource) || dynamicImports.includes(orphanSource)
    )
    assert.ok(parent)
    parent.imports = parent.imports.filter(
      (reference) => reference !== orphanSource
    )
    parent.dynamicImports = parent.dynamicImports.filter(
      (reference) => reference !== orphanSource
    )
  })
})

test('rejects stale and repository-mismatched provenance', async () => {
  const stale = globalThis.structuredClone(evidence)
  stale.metadata.generatedAt = new Date(
    Date.now() - 10 * 60 * 1_000
  ).toISOString()
  await assert.rejects(
    () =>
      assertPhase10BundleEvidenceProvenance({
        evidence: stale,
        repositoryRoot
      }),
    /PHASE10_BUNDLE_EVIDENCE_STALE/u
  )
  const wrongCommit = globalThis.structuredClone(evidence)
  wrongCommit.metadata.commit = '0'.repeat(40)
  await assert.rejects(
    () =>
      assertPhase10BundleEvidenceProvenance({
        evidence: wrongCommit,
        repositoryRoot
      }),
    /PHASE10_BUNDLE_EVIDENCE_PROVENANCE_MISMATCH/u
  )
})

test('removes atomic temporary evidence after rename failure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase10-bundle-write-'))
  const evidencePath = path.join(directory, 'bundle.json')
  await mkdir(evidencePath)
  await assert.rejects(() =>
    writeCanonicalBundleEvidence(evidencePath, evidence)
  )
  assert.deepEqual(
    (await readdir(directory)).filter(
      (name) => name.startsWith('.bundle.json.') && name.endsWith('.tmp')
    ),
    []
  )
})

test(
  'stops the complete build process group when SIGTERM arrives during the build',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await runHangingBundleBuild({ sendSignal: true })
    assert.equal(result.code, 143)
    assert.equal(result.signal, null)
    assert.doesNotMatch(result.stderr, /PHASE10_BUNDLE_/u)
  }
)

test(
  'times out and cleans the complete build process group',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await runHangingBundleBuild({ sendSignal: false })
    assert.equal(result.code, 1)
    assert.equal(result.signal, null)
    assert.match(result.stderr, /PHASE10_BUNDLE_COMMAND_TIMEOUT/u)
  }
)

test('removes final evidence when termination arrives after provenance', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase10-bundle-signal-'))
  const evidencePath = path.join(directory, 'bundle.json')
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['scripts/phase10-production-bundle-check.mjs'],
        {
          cwd: webRoot,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            PHASE10_BUNDLE_TEST_SIGNAL_AFTER_PROVENANCE: 'SIGTERM',
            PHASE10_PERFORMANCE_EVIDENCE_DIR: directory
          },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.once('error', reject)
      child.once('close', (code, signal) => {
        resolve({ code, signal, stderr, stdout })
      })
    })
    assert.equal(result.code, 143)
    assert.equal(result.signal, null)
    assert.doesNotMatch(result.stderr, /PHASE10_BUNDLE_/u)
    assert.doesNotMatch(result.stdout, /phase10\.bundle_performance\.passed/u)
    await assert.rejects(() => access(evidencePath))
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
