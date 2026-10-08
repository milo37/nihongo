import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertPhase10BundleEvidence } from './phase10-production-bundle-contract.mjs'

const canonicalize = (value) => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('PHASE10_BUNDLE_EVIDENCE_NONFINITE')
    }
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonicalize(value[key])])
    )
  }
  throw new Error('PHASE10_BUNDLE_EVIDENCE_UNSUPPORTED_VALUE')
}

export const cleanupPhase10BundleEvidence = async (evidenceFile) => {
  const evidenceDirectory = path.dirname(evidenceFile)
  const temporaryPrefix = `.${path.basename(evidenceFile)}.`
  await rm(evidenceFile, { force: true, recursive: true })
  let entries
  try {
    entries = await readdir(evidenceDirectory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  await Promise.all(
    entries
      .filter(
        ({ name }) => name.startsWith(temporaryPrefix) && name.endsWith('.tmp')
      )
      .map(({ name }) =>
        rm(path.join(evidenceDirectory, name), {
          force: true,
          recursive: true
        })
      )
  )
}

export const writeCanonicalBundleEvidence = async (filePath, evidence) => {
  assertPhase10BundleEvidence(evidence)
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  )
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(canonicalize(evidence), null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}
