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
  phase10SplitBundleCommand,
  phase10ApprovedStaticAssetPaths,
  assertPhase10BundleEvidenceProvenance
} from './phase10-production-bundle-contract.mjs'
import { writeCanonicalBundleEvidence } from './phase10-production-bundle-evidence-files.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(webRoot, '../..')
const evidenceDirectory = path.resolve(
  process.env.PHASE10_PERFORMANCE_EVIDENCE_DIR ??
    path.join(repositoryRoot, 'test-results/phase10-evidence/performance')
)
const splitEvidence = JSON.parse(
  await readFile(path.join(evidenceDirectory, 'bundle.json'), 'utf8')
)

const evidence = splitEvidence.artifacts.web.evidence

const expectRejected = (mutate, artifact = 'web') => {
  const candidate = JSON.parse(JSON.stringify(splitEvidence))
  mutate(candidate.artifacts[artifact].evidence)
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
  assert.doesNotThrow(() => assertPhase10BundleEvidence(splitEvidence))
  assert.equal(
    evidence.metadata.command,
    'pnpm exec vite build --manifest .vite/phase10-manifest.json --ssrManifest .vite/phase10-ssr-manifest.json --outDir <temporary-out-dir> --emptyOutDir'
  )
  assert.doesNotMatch(evidence.metadata.command, /nihongo-phase10-bundle-/u)
  await assert.doesNotReject(() =>
    assertPhase10BundleEvidenceProvenance({
      evidence: splitEvidence,
      repositoryRoot
    })
  )
})

test('rejects stale and different Vite toolchain versions', () => {
  for (const version of ['8.2.1', '8.2.3', '8.2.5', '9.0.0']) {
    expectRejected((candidate) => {
      candidate.metadata.versions.vite = version
    })
  }
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
    const beforeAssets = new Set(
      candidate.modules.rows.flatMap(({ assets }) => assets)
    )
    const row = candidate.modules.rows.find(({ assets }) => assets.length > 0)
    assert.ok(row)
    const removedAsset = [...row.assets].sort()[0]
    assert.ok(removedAsset)
    assert.ok(
      candidate.inventory.rows.some(
        ({ path: file }) => `/${file}` === removedAsset
      )
    )
    for (const moduleRow of candidate.modules.rows) {
      moduleRow.assets = moduleRow.assets
        .filter((asset) => asset !== removedAsset)
        .sort()
    }
    const afterAssets = new Set(
      candidate.modules.rows.flatMap(({ assets }) => assets)
    )
    assert.equal(afterAssets.has(removedAsset), false)
    assert.equal(afterAssets.size, beforeAssets.size - 1)
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
  const stale = globalThis.structuredClone(splitEvidence)
  stale.metadata.generatedAt = new Date(
    Date.now() - 10 * 60 * 1_000
  ).toISOString()
  for (const profile of Object.values(stale.artifacts))
    profile.evidence.metadata.generatedAt = stale.metadata.generatedAt
  await assert.rejects(
    () =>
      assertPhase10BundleEvidenceProvenance({
        evidence: stale,
        repositoryRoot
      }),
    /PHASE10_BUNDLE_EVIDENCE_STALE/u
  )
  const wrongTree = globalThis.structuredClone(splitEvidence)
  wrongTree.metadata.sourceTreeSha256 = '0'.repeat(64)
  for (const profile of Object.values(wrongTree.artifacts))
    profile.evidence.metadata.sourceTreeSha256 =
      wrongTree.metadata.sourceTreeSha256
  await assert.rejects(
    () =>
      assertPhase10BundleEvidenceProvenance({
        evidence: wrongTree,
        repositoryRoot
      }),
    /PHASE10_BUNDLE_EVIDENCE_PROVENANCE_MISMATCH/u
  )
})

test('removes atomic temporary evidence after rename failure', async () => {
  const temporaryDirectoriesBefore = new Set(
    (await readdir(tmpdir())).filter((name) =>
      name.startsWith('phase10-bundle-write-')
    )
  )
  const directory = await mkdtemp(path.join(tmpdir(), 'phase10-bundle-write-'))
  const evidencePath = path.join(directory, 'bundle.json')
  try {
    await mkdir(evidencePath)
    await assert.rejects(() =>
      writeCanonicalBundleEvidence(evidencePath, splitEvidence)
    )
    assert.deepEqual(
      (await readdir(directory)).filter(
        (name) => name.startsWith('.bundle.json.') && name.endsWith('.tmp')
      ),
      []
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }

  await assert.rejects(() => access(directory), { code: 'ENOENT' })
  assert.deepEqual(
    new Set(
      (await readdir(tmpdir())).filter((name) =>
        name.startsWith('phase10-bundle-write-')
      )
    ),
    temporaryDirectoriesBefore
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

test('retains approved static bytes and validates the separated totals against real output', async () => {
  assert.equal(evidence.schemaVersion, 3)
  const staticRows = evidence.inventory.rows.filter(({ path: file }) =>
    phase10ApprovedStaticAssetPaths.includes(file)
  )
  assert.equal(staticRows.length, 12)
  for (const row of staticRows) {
    const source = await readFile(path.join(webRoot, 'public', row.path))
    assert.equal(
      row.contentSha256,
      createHash('sha256').update(source).digest('hex')
    )
    assert.equal(row.raw, source.length)
  }
  for (const field of ['gzipBytes', 'rawBytes']) {
    const rowKey = field === 'gzipBytes' ? 'gzip' : 'raw'
    const staticTotal = staticRows.reduce(
      (total, row) => total + row[rowKey],
      0
    )
    assert.equal(
      evidence.payloadAccounting.approvedStaticAssets[field],
      staticTotal
    )
    assert.equal(
      evidence.payloadAccounting.emittedPayload[field],
      evidence.inventory.rows.reduce((total, row) => total + row[rowKey], 0)
    )
    const metric = field === 'gzipBytes' ? 'totalGzipBytes' : 'totalRawBytes'
    assert.equal(
      evidence.measurements[metric] + staticTotal,
      evidence.payloadAccounting.emittedPayload[field]
    )
  }
  expectRejected((candidate) => {
    candidate.payloadAccounting.approvedStaticAssets.paths.push('index.html')
  })
  expectRejected((candidate) => {
    candidate.payloadAccounting.approvedStaticAssets.rawBytes += 1
  })
  expectRejected((candidate) => {
    candidate.payloadAccounting.emittedPayload.gzipBytes -= 1
  })
  expectRejected((candidate) => {
    candidate.payloadAccounting.totalMeasurementScope =
      'all-static-assets-excluded'
  })
  expectRejected((candidate) => {
    candidate.schemaVersion = 1
  })
})

test('keeps both complete locale resources in real dynamic chunks', () => {
  for (const locale of ['ko', 'ja']) {
    const entry = evidence.graph.find(
      ({ source }) =>
        source === `packages/browser/src/i18n/resources/${locale}.ts`
    )
    assert.ok(entry)
    assert.equal(entry.isDynamicEntry, true)
    assert.equal(entry.isInitial, false)
  }
})

test('correlates real forwarding proof bytes, bindings, graph and SSR coverage', () => {
  assert.ok(evidence.forwardingFacades.length > 0)
  const proof = evidence.forwardingFacades[0]
  const row = evidence.inventory.rows.find(
    ({ path: file }) => file === proof.path
  )
  assert.ok(row)
  assert.equal(proof.contentSha256, row.contentSha256)
  assert.equal(proof.rawBytes, row.raw)
  assert.equal(proof.gzipBytes, row.gzip)
  assert.equal(proof.identity.body, null)
  for (const mutate of [
    (candidate) => {
      candidate.forwardingFacades[0].target = 'assets/not-emitted.js'
    },
    (candidate) => {
      candidate.forwardingFacades[0].contentSha256 = '0'.repeat(64)
    },
    (candidate) => {
      candidate.forwardingFacades[0].identity.bindings[0].exported = 'forged'
    },
    (candidate) => {
      candidate.forwardingFacades[0].source = 'src/unknown/page.tsx'
    },
    (candidate) => {
      candidate.forwardingFacades[0].syntaxTokens.push('(', ')')
    },
    (candidate) => {
      candidate.forwardingFacades[0].syntaxTokens = [
        'import',
        '"https://example.test/a.js"',
        ';'
      ]
    },
    (candidate) => {
      candidate.forwardingFacades = []
    },
    (candidate) => {
      candidate.forwardingFacades.push(candidate.forwardingFacades[0])
    },
    (candidate) => {
      candidate.schemaVersion = 2
    }
  ])
    expectRejected(mutate)
})

test('binds both original per-artifact budgets and informational combined totals without a second static allowance', () => {
  assert.equal(splitEvidence.schemaVersion, 4)
  assert.equal(splitEvidence.metadata.command, phase10SplitBundleCommand)
  const profiles = splitEvidence.artifacts
  assert.deepEqual(Object.keys(profiles).toSorted(), ['admin', 'web'])
  for (const artifact of ['web', 'admin']) {
    assert.equal(profiles[artifact].evidence.status, 'passed')
    assert.ok(
      Object.values(profiles[artifact].evidence.budgets).every(
        (budget) => budget.passed
      )
    )
    assert.equal(profiles[artifact].base, artifact === 'web' ? '/' : '/admin/')
    assert.equal(profiles[artifact].buildManifest.artifact, artifact)
    assert.equal(
      profiles[artifact].buildManifest.releaseId,
      splitEvidence.metadata.commit
    )
    for (const locale of ['ko', 'ja']) {
      assert.ok(
        profiles[artifact].evidence.graph.some(
          (entry) =>
            entry.source === `packages/browser/src/i18n/resources/${locale}.ts`
        )
      )
    }
  }
  const combined = splitEvidence.combined
  assert.equal(combined.evaluation, 'informational')
  assert.equal(splitEvidence.status, 'passed')
  assert.doesNotThrow(() => assertPhase10BundleEvidence(splitEvidence))
  assert.equal(
    combined.measurements.emittedFileCount,
    profiles.web.evidence.inventory.rows.length +
      profiles.admin.evidence.inventory.rows.length
  )
  assert.equal(
    combined.measurements.totalRawBytes,
    combined.payloadAccounting.emittedPayload.rawBytes -
      profiles.web.evidence.payloadAccounting.approvedStaticAssets.rawBytes
  )
  for (const mutate of [
    (candidate) => {
      delete candidate.artifacts.admin
    },
    (candidate) => {
      candidate.artifacts.admin.base = '/'
    },
    (candidate) => {
      candidate.artifacts.admin.buildManifest.artifact = 'web'
    },
    (candidate) => {
      candidate.artifacts.admin.evidence.metadata.versions.vite = '0.0.0'
    },
    (candidate) => {
      candidate.status = 'failed'
    },
    (candidate) => {
      candidate.artifacts.admin.evidence.status = 'failed'
    },
    (candidate) => {
      candidate.combined.evaluation = 'enforced'
    },
    (candidate) => {
      candidate.combined.inventory.rows.pop()
    },
    (candidate) => {
      candidate.combined.measurements.totalRawBytes -=
        candidate.artifacts.admin.evidence.payloadAccounting.approvedStaticAssets.rawBytes
    },
    (candidate) => {
      candidate.combined.budgets.totalRawBytes.ceiling *= 2
    }
  ]) {
    const candidate = globalThis.structuredClone(splitEvidence)
    mutate(candidate)
    assert.throws(() => assertPhase10BundleEvidence(candidate), /PHASE10_/u)
  }
})
