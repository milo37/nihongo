import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import {
  containsForbiddenControlCharacter,
  isNfc
} from '@nihongo/domain/content/validators/v1/unicode'
import { readArtifactBytes } from './artifactReader.js'
import {
  canonicalJsonBytes,
  canonicalJsonSha256,
  sha256Bytes
} from './canonicalHash.js'
import {
  type ReleasePolicySnapshotV1,
  RELEASE_POLICY_FILE_KEYS,
  releasePolicySnapshotSchema,
  policyOwnerSignaturePayloadSchema,
  type ValidatorRuntimeManifestV1,
  validatorRuntimeManifestSchema,
  validatorSourceManifestSchema,
  WORKSPACE_PACKAGE_MANIFEST_PATHS
} from './policySchemas.js'
import { parseStrictJsonBytes } from './strictJson.js'
import { VALIDATOR_SOURCE_PATHS_V1 } from './sourceManifest.js'

export const PINNED_NODE_BASE_IMAGE_INDEX_SHA256 =
  'ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd'
export const VALIDATOR_POSTGRES_IMAGE_SHA256 =
  '9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'

const POLICY_FILE_PATHS = {
  'content-bundle-schema': 'content/schema/content-bundle.schema.v1.json',
  'contributors-registry': 'content/contributors.v1.json',
  'duplicate-review-plan-schema':
    'content/review/duplicate-review-plan.schema.v1.json',
  'internal-beta-coverage': 'content/coverage/internal-beta.v1.json',
  'original-content-policy': 'content/policies/original-content-policy.v1.md',
  'policy-activation-schema':
    'content/policies/policy-activation.schema.v1.json',
  'quality-rules': 'content/policies/quality-rules.v1.json',
  'release-approval-receipt-schema':
    'content/review/release-approval-receipt.schema.v1.json',
  'review-certificate-schema':
    'content/review/review-certificate.schema.v1.json',
  'review-rubric': 'content/review/review-rubric.v1.md',
  'tag-taxonomy': 'content/taxonomy/tags.v1.json'
} as const

export interface BuildPolicyArtifactsInput {
  readonly repositoryRoot: string
  readonly runtimeImageIndexSha256: string
  readonly postgresImageSha256?: string
  readonly rootKeyFingerprintSha256: string
}

export interface BuiltPolicyArtifactsV1 {
  readonly sourceManifest: ReturnType<
    typeof validatorSourceManifestSchema.parse
  >
  readonly runtimeManifest: ValidatorRuntimeManifestV1
  readonly snapshot: ReleasePolicySnapshotV1
  readonly policySnapshotSha256: string
  readonly snapshotBytes: Buffer
  readonly ownerSignaturePayloadBytes: Buffer
}

const canonicalPolicyFileContent = async (
  repositoryRoot: string,
  repositoryPath: string,
  mediaType: 'application/json' | 'text/markdown'
): Promise<string> => {
  const bytes = await readArtifactBytes({
    repositoryRoot,
    filePath: repositoryPath,
    maximumBytes: 10 * 1024 * 1024
  })
  if (mediaType === 'application/json') {
    return canonicalizeJson(parseStrictJsonBytes(bytes))
  }
  let content: string
  try {
    content = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true
    }).decode(bytes)
  } catch {
    throw new Error('POLICY_MARKDOWN_INVALID')
  }
  if (
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    content.includes('\r') ||
    !content.endsWith('\n') ||
    !isNfc(content) ||
    containsForbiddenControlCharacter(content)
  ) {
    throw new Error('POLICY_MARKDOWN_INVALID')
  }
  return content
}

export const buildPolicyArtifacts = async ({
  repositoryRoot,
  runtimeImageIndexSha256,
  postgresImageSha256 = VALIDATOR_POSTGRES_IMAGE_SHA256,
  rootKeyFingerprintSha256
}: BuildPolicyArtifactsInput): Promise<BuiltPolicyArtifactsV1> => {
  const sourceFiles = await Promise.all(
    VALIDATOR_SOURCE_PATHS_V1.map(async (repositoryPath) => ({
      repositoryPath,
      sha256: sha256Bytes(
        await readArtifactBytes({
          repositoryRoot,
          filePath: repositoryPath,
          maximumBytes: 10 * 1024 * 1024
        })
      )
    }))
  )
  const sourceManifest = validatorSourceManifestSchema.parse({
    schemaVersion: 1,
    validatorVersion: 'v1',
    files: sourceFiles
  })

  const [lockBytes, workspacePackageManifestSha256s] = await Promise.all([
    readArtifactBytes({
      repositoryRoot,
      filePath: 'pnpm-lock.yaml',
      maximumBytes: 10 * 1024 * 1024
    }),
    Promise.all(
      WORKSPACE_PACKAGE_MANIFEST_PATHS.map(async (manifestPath) => ({
        path: manifestPath,
        sha256: sha256Bytes(
          await readArtifactBytes({
            repositoryRoot,
            filePath: manifestPath,
            maximumBytes: 1024 * 1024
          })
        )
      }))
    )
  ])
  const runtimeManifest = validatorRuntimeManifestSchema.parse({
    schemaVersion: 1,
    runtimeImageIndexSha256,
    nodeVersion: '22.23.0',
    icuVersion: '78.2',
    unicodeVersion: '17.0',
    pnpmVersion: '10.2.1',
    pnpmLockSha256: sha256Bytes(lockBytes),
    workspacePackageManifestSha256s,
    openSshVersion: 'OpenSSH_9.9p2',
    postgresVersion: '18.4',
    postgresImageSha256,
    requiredExtensions: []
  })

  const syntheticJson = new Map<string, unknown>([
    ['validator-source-manifest', sourceManifest],
    ['validator-runtime-manifest', runtimeManifest]
  ])
  const files = await Promise.all(
    RELEASE_POLICY_FILE_KEYS.map(async (key) => {
      const mediaType =
        key === 'original-content-policy' || key === 'review-rubric'
          ? 'text/markdown'
          : 'application/json'
      const synthetic = syntheticJson.get(key)
      const canonicalContent =
        synthetic === undefined
          ? await canonicalPolicyFileContent(
              repositoryRoot,
              POLICY_FILE_PATHS[key as keyof typeof POLICY_FILE_PATHS],
              mediaType
            )
          : canonicalizeJson(synthetic)
      return {
        key,
        mediaType,
        sha256: sha256Bytes(Buffer.from(canonicalContent, 'utf8')),
        canonicalContent
      }
    })
  )
  const snapshot = releasePolicySnapshotSchema.parse({
    schemaVersion: 1,
    canonicalizationVersion: 'rfc8785-nihongo-v1',
    files
  })
  const snapshotBytes = canonicalJsonBytes(snapshot)
  const policySnapshotSha256 = canonicalJsonSha256(snapshot)
  const ownerPayload = policyOwnerSignaturePayloadSchema.parse({
    schemaVersion: 1,
    role: 'POLICY_OWNER',
    policySnapshotSha256,
    rootKeyFingerprintSha256
  })
  return {
    sourceManifest,
    runtimeManifest,
    snapshot,
    policySnapshotSha256,
    snapshotBytes,
    ownerSignaturePayloadBytes: canonicalJsonBytes(ownerPayload)
  }
}
