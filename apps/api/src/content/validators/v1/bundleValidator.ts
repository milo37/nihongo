import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import { summarizeBundleCoverage } from '@nihongo/domain/content/validators/v1/coverage'
import {
  canonicalDuplicateIdentity,
  inspectIntraBundleDuplicates
} from '@nihongo/domain/content/validators/v1/duplicates'
import {
  normalizeContentBundleForHash,
  normalizeContentBundleItemForHash,
  toContentItemHashInput,
  toPersistedQuestionSemantic
} from '@nihongo/domain/content/validators/v1/question-content'
import type {
  ContentBundleItemV1,
  ContentBundleV1,
  PersistedQuestionSemanticV1
} from '@nihongo/domain/content/validators/v1/types'
import {
  compareUnicodeScalars,
  normalizeTagKey
} from '@nihongo/domain/content/validators/v1/unicode'
import { readArtifactJson } from './artifactReader.js'
import { canonicalJsonSha256, sha256Bytes } from './canonicalHash.js'
import {
  bundleCoverageSummarySchema,
  contentBundleSchema,
  type TagTaxonomyV1
} from './contentSchemas.js'
import {
  authorSignaturePayloadSchema,
  type ContributorsRegistryV1
} from './policySchemas.js'
import type { VerifiedPolicySnapshotV1 } from './policyVerifier.js'
import {
  parseSshEd25519PublicKey,
  verifySshSignature
} from './sshsigVerifier.js'

const MAX_BUNDLE_BYTES = 10 * 1024 * 1024
const FIVE_MINUTES_MS = 5 * 60 * 1000

export type BundleValidationRuleCode =
  | 'AUTHOR_INVALID'
  | 'BUNDLE_CREATED_AT_FUTURE'
  | 'BUNDLE_EXACT_DUPLICATE'
  | 'BUNDLE_METADATA_RESTRICTED'
  | 'BUNDLE_POLICY_MISMATCH'
  | 'BUNDLE_TAG_DEPRECATED'
  | 'BUNDLE_TAG_NOT_APPLICABLE'
  | 'BUNDLE_TAG_NOT_CANONICAL'
  | 'BUNDLE_TAG_UNKNOWN'
  | 'BUNDLE_TAXONOMY_INVALID'

export class BundleValidationError extends Error {
  readonly code: BundleValidationRuleCode
  readonly contentKey: string | undefined

  constructor(
    code: BundleValidationRuleCode,
    message: string,
    contentKey?: string
  ) {
    super(message)
    this.name = 'BundleValidationError'
    this.code = code
    this.contentKey = contentKey
  }
}

const restrictedMetadataPatterns = [
  /\bhttps?:\/\//iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b(?:api[_-]?key|authorization|bearer|credential|password|secret|token)\b/iu,
  /\b(?:user|account)[_-]?id\b/iu,
  /(?:\+?\d[\d .()-]{7,}\d)/u
] as const

export const assertRetainedMetadataSafe = (
  value: string,
  contentKey?: string
): void => {
  if (restrictedMetadataPatterns.some((pattern) => pattern.test(value))) {
    throw new BundleValidationError(
      'BUNDLE_METADATA_RESTRICTED',
      'retained metadata에 개인 정보·URL·credential 의심 값이 있습니다.',
      contentKey
    )
  }
}

const assertPedagogicalBodySafe = (item: ContentBundleItemV1): void => {
  const bodyValues = [
    item.content.passage,
    item.content.questionText,
    ...item.content.options.map(({ text }) => text),
    item.content.explanationKo,
    item.content.explanationJa,
    ...Object.values(item.content.distractorRationalesKo)
  ]

  for (const value of bodyValues) {
    if (value !== null) {
      assertRetainedMetadataSafe(value, item.contentKey)
    }
  }
}

const createTaxonomyLookup = (
  taxonomy: TagTaxonomyV1
): ReadonlyMap<string, TagTaxonomyV1['tags'][number]> => {
  const ordered = taxonomy.tags.toSorted((left, right) =>
    compareUnicodeScalars(left.key, right.key)
  )
  const keys = new Set<string>()
  const aliases = new Map<string, string>()
  for (const [index, tag] of taxonomy.tags.entries()) {
    if (tag !== ordered[index] || normalizeTagKey(tag.key) !== tag.key) {
      throw new BundleValidationError(
        'BUNDLE_TAXONOMY_INVALID',
        'taxonomy tag key ordering 또는 normalization이 유효하지 않습니다.'
      )
    }
    if (keys.has(tag.key)) {
      throw new BundleValidationError(
        'BUNDLE_TAXONOMY_INVALID',
        'taxonomy canonical tag key가 중복되었습니다.'
      )
    }
    keys.add(tag.key)
    for (const source of [tag.key, ...tag.aliases]) {
      const normalized = normalizeTagKey(source)
      const existing = aliases.get(normalized)
      if (existing !== undefined && existing !== tag.key) {
        throw new BundleValidationError(
          'BUNDLE_TAXONOMY_INVALID',
          'taxonomy alias가 둘 이상의 canonical key를 가리킵니다.'
        )
      }
      aliases.set(normalized, tag.key)
    }
  }
  return new Map(
    [...aliases].map(([source, target]) => [
      source,
      byCanonicalKey(taxonomy, target)
    ])
  )
}

const byCanonicalKey = (
  taxonomy: TagTaxonomyV1,
  key: string
): TagTaxonomyV1['tags'][number] => {
  const tag = taxonomy.tags.find((candidate) => candidate.key === key)
  if (!tag) {
    throw new BundleValidationError(
      'BUNDLE_TAXONOMY_INVALID',
      'taxonomy alias target이 존재하지 않습니다.'
    )
  }
  return tag
}

const resolveBundleTags = (
  item: ContentBundleItemV1,
  taxonomyLookup: ReadonlyMap<string, TagTaxonomyV1['tags'][number]>
): readonly string[] => {
  const resolved = new Set<string>()
  for (const tagKey of item.content.tagKeys) {
    const tag = taxonomyLookup.get(normalizeTagKey(tagKey))
    if (!tag) {
      throw new BundleValidationError(
        'BUNDLE_TAG_UNKNOWN',
        'bundle tagKey가 pinned taxonomy에 없습니다.',
        item.contentKey
      )
    }
    if (resolved.has(tag.key)) {
      throw new BundleValidationError(
        'BUNDLE_TAG_NOT_CANONICAL',
        '둘 이상의 tagKey/alias가 같은 canonical tag를 가리킵니다.',
        item.contentKey
      )
    }
    if (tag.status !== 'ACTIVE') {
      throw new BundleValidationError(
        'BUNDLE_TAG_DEPRECATED',
        'deprecated tag는 새 bundle에 사용할 수 없습니다.',
        item.contentKey
      )
    }
    if (
      !tag.applicableLevels.includes(item.content.level) ||
      !tag.applicableSubjects.includes(item.content.subject) ||
      !tag.applicableQuestionTypes.includes(item.content.questionType)
    ) {
      throw new BundleValidationError(
        'BUNDLE_TAG_NOT_APPLICABLE',
        'tag가 item level/subject/questionType에 적용되지 않습니다.',
        item.contentKey
      )
    }
    resolved.add(tag.key)
  }
  return [...resolved].toSorted(compareUnicodeScalars)
}

export interface BundleItemProjectionV1 {
  readonly contentKey: string
  readonly semantic: PersistedQuestionSemanticV1
  readonly semanticContentSha256: string
  readonly itemSha256: string
  readonly duplicateIdentitySha256: string
}

export interface ValidatedBundleV1 {
  readonly bundle: ContentBundleV1
  readonly canonicalBundle: ContentBundleV1
  readonly bundleSha256: string
  readonly authorRef: string
  readonly items: readonly BundleItemProjectionV1[]
  readonly duplicateWarnings: ReturnType<
    typeof inspectIntraBundleDuplicates
  >['warnings']
  readonly coverage: ReturnType<typeof summarizeBundleCoverage>
  readonly policy: VerifiedPolicySnapshotV1
}

export interface ValidateBundleInput {
  readonly bundle: unknown
  readonly policy: VerifiedPolicySnapshotV1
  readonly now: Date
}

export const validateBundle = ({
  bundle: inputBundle,
  policy,
  now
}: ValidateBundleInput): ValidatedBundleV1 => {
  const bundle = contentBundleSchema.parse(inputBundle)
  const trustedNowMs = now.getTime()
  if (!Number.isFinite(trustedNowMs)) {
    throw new BundleValidationError(
      'BUNDLE_CREATED_AT_FUTURE',
      'trusted now가 유효하지 않습니다.'
    )
  }
  if (bundle.policySnapshotSha256 !== policy.policySnapshotSha256) {
    throw new BundleValidationError(
      'BUNDLE_POLICY_MISMATCH',
      'bundle이 pinned policy snapshot과 일치하지 않습니다.'
    )
  }
  if (Date.parse(bundle.createdAt) > trustedNowMs + FIVE_MINUTES_MS) {
    throw new BundleValidationError(
      'BUNDLE_CREATED_AT_FUTURE',
      'bundle createdAt이 trusted now보다 5분 넘게 미래입니다.'
    )
  }
  const taxonomyLookup = createTaxonomyLookup(policy.taxonomy)
  assertRetainedMetadataSafe(bundle.title)
  const resolvedItems = bundle.items.map((item) => {
    assertRetainedMetadataSafe(item.provenance.sourceNote, item.contentKey)
    assertPedagogicalBodySafe(item)
    if (item.intent.kind === 'NEW_VERSION') {
      assertRetainedMetadataSafe(item.intent.changeSummary, item.contentKey)
    }
    return {
      ...item,
      content: {
        ...item.content,
        tagKeys: resolveBundleTags(item, taxonomyLookup)
      }
    }
  })
  const resolvedBundle = { ...bundle, items: resolvedItems }

  const duplicates = inspectIntraBundleDuplicates(resolvedBundle.items)
  if (duplicates.exactPairs.length > 0) {
    throw new BundleValidationError(
      'BUNDLE_EXACT_DUPLICATE',
      'bundle 내부에 unrelated exact duplicate가 있습니다.'
    )
  }
  const canonicalBundle = normalizeContentBundleForHash(resolvedBundle)
  const items = canonicalBundle.items.map((item) => {
    const semantic = toPersistedQuestionSemantic(item.content)
    return {
      contentKey: item.contentKey,
      semantic,
      semanticContentSha256: canonicalJsonSha256(semantic),
      itemSha256: canonicalJsonSha256(
        toContentItemHashInput(normalizeContentBundleItemForHash(item))
      ),
      duplicateIdentitySha256: sha256Bytes(
        canonicalDuplicateIdentity(item.content)
      )
    }
  })

  return {
    bundle: resolvedBundle,
    canonicalBundle,
    bundleSha256: canonicalJsonSha256(canonicalBundle),
    authorRef: canonicalBundle.items[0]?.provenance.authorRef ?? '',
    items,
    duplicateWarnings: duplicates.warnings,
    coverage: bundleCoverageSummarySchema.parse(
      summarizeBundleCoverage(canonicalBundle.items)
    ),
    policy
  }
}

export const readAndValidateBundle = async (
  repositoryRoot: string,
  bundlePath: string,
  policy: VerifiedPolicySnapshotV1,
  now: Date
): Promise<ValidatedBundleV1> =>
  validateBundle({
    bundle: await readArtifactJson({
      repositoryRoot,
      filePath: bundlePath,
      maximumBytes: MAX_BUNDLE_BYTES
    }),
    policy,
    now
  })

const findActiveContributor = (
  registry: ContributorsRegistryV1,
  contributorRef: string,
  role: 'AUTHOR' | 'REVIEWER'
): ContributorsRegistryV1['contributors'][number] => {
  const contributor = registry.contributors.find(
    (candidate) => candidate.contributorRef === contributorRef
  )
  if (!contributor?.active || !contributor.roles.includes(role)) {
    throw new BundleValidationError(
      'AUTHOR_INVALID',
      'pinned contributors registry에 active role이 없습니다.'
    )
  }
  const parsed = parseSshEd25519PublicKey(contributor.sshPublicKey)
  if (parsed.fingerprintSha256 !== contributor.sshKeyFingerprintSha256) {
    throw new BundleValidationError(
      'AUTHOR_INVALID',
      'contributor public key fingerprint가 일치하지 않습니다.'
    )
  }
  return contributor
}

export interface VerifyBundleAuthorSignatureInput {
  readonly validatedBundle: ValidatedBundleV1
  readonly signature: Uint8Array
}

export const verifyBundleAuthorSignature = async ({
  validatedBundle,
  signature
}: VerifyBundleAuthorSignatureInput): Promise<void> => {
  const contributor = findActiveContributor(
    validatedBundle.policy.contributorsRegistry,
    validatedBundle.authorRef,
    'AUTHOR'
  )
  const payload = authorSignaturePayloadSchema.parse({
    schemaVersion: 1,
    role: 'AUTHOR',
    authorRef: validatedBundle.authorRef,
    bundleSha256: validatedBundle.bundleSha256,
    policySnapshotSha256: validatedBundle.bundle.policySnapshotSha256
  })
  await verifySshSignature({
    payload: Buffer.from(canonicalizeJson(payload), 'utf8'),
    signature,
    publicKey: contributor.sshPublicKey,
    expectedFingerprintSha256: contributor.sshKeyFingerprintSha256,
    identity: contributor.contributorRef,
    namespace: 'nihongo-content-v1'
  })
}

export const getActiveContributor = findActiveContributor
