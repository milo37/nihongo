import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { cleanupPhase10BundleEvidence } from './phase10-production-bundle-evidence-files.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(webRoot, '../..')
const evidenceDirectory = path.resolve(
  process.env.PHASE10_PERFORMANCE_EVIDENCE_DIR ??
    path.join(repositoryRoot, 'test-results/phase10-evidence/performance')
)

await cleanupPhase10BundleEvidence(path.join(evidenceDirectory, 'bundle.json'))
