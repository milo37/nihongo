import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { assertBrowserArtifact } from '../../../scripts/operations/browser-artifact-check.mjs'
import {
  assertPhase10BundleEvidenceProvenance,
  collectPhase10BundleEvidence,
  phase10SplitBundleCommand,
  readPhase10BundleRepositoryState
} from './phase10-production-bundle-contract.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(webRoot, '../..')

const run = async () => {
  const distDirectories = {
    web: path.join(repositoryRoot, 'apps/web/dist'),
    admin: path.join(repositoryRoot, 'apps/admin/dist')
  }
  for (const [artifact, directory] of Object.entries(distDirectories)) {
    assertBrowserArtifact(artifact, directory)
  }

  const [repositoryState, vitePackage] = await Promise.all([
    readPhase10BundleRepositoryState(repositoryRoot),
    readFile(path.join(webRoot, 'node_modules/vite/package.json'), 'utf8').then(
      JSON.parse
    )
  ])
  const evidence = await collectPhase10BundleEvidence({
    distDirectories,
    metadata: {
      command: phase10SplitBundleCommand,
      commit: repositoryState.commit,
      environment: {
        apiBaseUrl: '/api',
        apiMode: 'real',
        nodeEnvironment: 'production'
      },
      generatedAt: new Date().toISOString(),
      mode: 'production',
      sourceTreeDirty: repositoryState.sourceTreeDirty,
      sourceTreeSha256: repositoryState.sourceTreeSha256,
      versions: {
        node: process.version,
        pnpm: execFileSync('pnpm', ['--version'], {
          cwd: repositoryRoot,
          encoding: 'utf8'
        }).trim(),
        vite: String(vitePackage.version ?? '')
      }
    }
  })
  await assertPhase10BundleEvidenceProvenance({ evidence, repositoryRoot })

  process.stdout.write(
    `${JSON.stringify({
      event: `bundle.performance.${evidence.status}`,
      artifacts: Object.fromEntries(
        Object.entries(evidence.artifacts).map(([artifact, profile]) => [
          artifact,
          profile.evidence.measurements
        ])
      )
    })}\n`
  )
  if (evidence.status !== 'passed') {
    throw new Error('BUNDLE_BUDGET_EXCEEDED')
  }
}

try {
  await run()
} catch (error) {
  const code =
    error instanceof Error && /^[A-Z][A-Z0-9_:.-]+$/u.test(error.message)
      ? error.message
      : 'BUNDLE_CHECK_FAILED'
  process.stderr.write(`${JSON.stringify({ event: 'bundle.failed', code })}\n`)
  process.exitCode = 1
}
