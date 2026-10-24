import { realpath } from 'node:fs/promises'
import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import { readArtifactJson } from '../src/content/validators/v1/artifactReader.js'
import {
  legacySeedManifestSchema,
  legacySeedMappingManifestSchema,
  legacySeedSourceManifestSchema
} from '../src/content/validators/v1/legacySchemas.js'
import { projectCanonicalLegacySeedArtifacts } from './phase6Slice1LegacyProjection.js'

export interface CanonicalLegacyArtifactCheckResultV1 {
  readonly schemaVersion: 1
  readonly command: 'content:check-legacy-projection'
  readonly status: 'PASS'
  readonly itemCount: 65
  readonly seedSourceManifestSha256: string
  readonly legacySeedMappingSha256: string
  readonly globalReviewSha256: string
}

const assertCanonicalValue = (actual: unknown, expected: unknown): void => {
  if (canonicalizeJson(actual) !== canonicalizeJson(expected)) {
    throw new Error('LEGACY_CANONICAL_PROJECTION_DRIFT')
  }
}

export const verifyCanonicalLegacyArtifacts = async (
  repositoryRoot: string
): Promise<CanonicalLegacyArtifactCheckResultV1> => {
  const canonicalRoot = await realpath(repositoryRoot)
  const expected = await projectCanonicalLegacySeedArtifacts(canonicalRoot)
  const [actualSource, actualMapping, actualManifest] = await Promise.all([
    readArtifactJson({
      repositoryRoot: canonicalRoot,
      filePath: 'content/legacy/legacy-seed-source-manifest.v1.json',
      maximumBytes: 5 * 1024 * 1024
    }).then((value) => legacySeedSourceManifestSchema.parse(value)),
    readArtifactJson({
      repositoryRoot: canonicalRoot,
      filePath: 'content/legacy/legacy-seed-mapping-manifest.v1.json',
      maximumBytes: 5 * 1024 * 1024
    }).then((value) => legacySeedMappingManifestSchema.parse(value)),
    readArtifactJson({
      repositoryRoot: canonicalRoot,
      filePath:
        'content/releases/legacy-system-seed-v1/1/legacy-seed-manifest.json',
      maximumBytes: 10 * 1024 * 1024
    }).then((value) => legacySeedManifestSchema.parse(value))
  ])
  assertCanonicalValue(actualSource, expected.sourceManifest)
  assertCanonicalValue(actualMapping, expected.mappingManifest)
  assertCanonicalValue(actualManifest, expected.manifest)
  return {
    schemaVersion: 1,
    command: 'content:check-legacy-projection',
    status: 'PASS',
    itemCount: 65,
    seedSourceManifestSha256: expected.sourceManifest.seedSourceManifestSha256,
    legacySeedMappingSha256: expected.mappingManifest.legacySeedMappingSha256,
    globalReviewSha256: expected.manifest.globalReviewSha256
  }
}

const main = async (): Promise<void> => {
  const [repositoryRoot] = process.argv.slice(2)
  if (repositoryRoot === undefined) {
    throw new Error('CONTENT_REPOSITORY_ROOT_INVALID')
  }
  const result = await verifyCanonicalLegacyArtifacts(repositoryRoot)
  process.stdout.write(`${canonicalizeJson(result)}\n`)
}

if (process.argv[1]?.endsWith('phase6Slice1ArtifactCheck.ts')) {
  main().catch(() => {
    process.stdout.write(
      '{"schemaVersion":1,"command":"content:check-legacy-projection","status":"ERROR","ruleCode":"LEGACY_CANONICAL_PROJECTION_DRIFT"}\n'
    )
    process.exitCode = 1
  })
}
