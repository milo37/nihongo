import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createOciEvidence, verifyOciEvidence } from './oci-evidence.mjs'
import { summarizeInventory } from './release-contract.mjs'

const digest = 'a'.repeat(64)
const releaseId = '1234567890abcdef1234567890abcdef12345678'
const apiArtifact = summarizeInventory([
  { bytes: 1, path: 'server.js', sha256: digest, type: 'file' }
])
const webArtifact = summarizeInventory([
  { bytes: 1, path: 'index.html', sha256: digest, type: 'file' }
])
const migrationDigest = createHash('sha256')
  .update(`init\0${digest}\n`)
  .digest('hex')
const manifest = {
  schemaVersion: 1,
  releaseId,
  source: { commit: releaseId, lockfileSha256: digest },
  runtime: { node: '22.23.0', pnpm: '10.2.1' },
  artifacts: {
    api: apiArtifact,
    web: webArtifact
  },
  migrations: {
    count: 1,
    digestSha256: migrationDigest,
    entries: [{ name: 'init', sha256: digest }]
  },
  environmentContract: {
    path: 'operations/environment-contract.v1.json',
    sha256: digest
  }
}

test('OCI evidence binds image and component manifest digests', () => {
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
  const evidence = createOciEvidence({
    imageId: `sha256:${'b'.repeat(64)}`,
    manifestBytes: bytes,
    releaseId
  })

  assert.equal(verifyOciEvidence(evidence), evidence)
  assert.equal(evidence.releaseId, releaseId)
  assert.equal(
    evidence.components.apiSha256,
    manifest.artifacts.api.digestSha256
  )
})

test('OCI evidence rejects release and schema drift', () => {
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
  assert.throws(
    () =>
      createOciEvidence({
        imageId: `sha256:${'b'.repeat(64)}`,
        manifestBytes: bytes,
        releaseId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      }),
    /release ID mismatch/u
  )
  assert.throws(
    () => verifyOciEvidence({ ...manifest, imageId: `sha256:${digest}` }),
    /invalid key set/u
  )
})
