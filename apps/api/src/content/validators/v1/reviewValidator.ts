import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import {
  canonicalDuplicateIdentity,
  scoreNearDuplicate
} from '@nihongo/domain/content/validators/v1/duplicates'
import {
  normalizeContentBundleItemForHash,
  normalizePersistedQuestionSemanticForHash,
  toContentItemHashInput,
  toPersistedQuestionSemantic
} from '@nihongo/domain/content/validators/v1/question-content'
import type { PersistedQuestionSemanticV1 } from '@nihongo/domain/content/validators/v1/types'
import { compareUnicodeScalars } from '@nihongo/domain/content/validators/v1/unicode'
import {
  readArtifactBytes,
  readArtifactJson,
  readPrivateArtifactJson
} from './artifactReader.js'
import {
  assertRetainedMetadataSafe,
  getActiveContributor,
  verifyBundleAuthorSignature,
  type ValidatedBundleV1
} from './bundleValidator.js'
import {
  canonicalJsonSha256,
  canonicalSelfHash,
  sha256Bytes
} from './canonicalHash.js'
import {
  reviewerSignaturePayloadSchema,
  type ContributorsRegistryV1
} from './policySchemas.js'
import {
  catalogDigestSchema,
  duplicateCorpusEvidenceSchema,
  duplicateReviewEvidenceSchema,
  duplicateReviewPlanSchema,
  reviewCertificateSchema
} from './reviewSchemas.js'
import { verifySshSignature } from './sshsigVerifier.js'

const REVIEW_PLAN_MAX_BYTES = 10 * 1024 * 1024
const REVIEW_EVIDENCE_MAX_BYTES = 50 * 1024 * 1024
const CATALOG_SNAPSHOT_MAX_BYTES = 10 * 1024 * 1024
const DUPLICATE_CORPUS_SNAPSHOT_MAX_BYTES = 50 * 1024 * 1024
const REVIEW_CERTIFICATE_MAX_BYTES = 5 * 1024 * 1024
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const FIVE_MINUTES_MS = 5 * 60 * 1000

type DuplicateCandidate = ReturnType<
  typeof duplicateReviewPlanSchema.parse
>['items'][number]['warnings'][number]['candidate']
type DuplicateWarning = ReturnType<
  typeof duplicateReviewPlanSchema.parse
>['items'][number]['warnings'][number]
type CatalogSnapshotV1 = ReturnType<typeof catalogDigestSchema.parse>
type DuplicateCorpusEvidenceV1 = ReturnType<
  typeof duplicateCorpusEvidenceSchema.parse
>
type DuplicateCorpusEvidenceVersionV1 =
  DuplicateCorpusEvidenceV1['versions'][number]

export type ReviewValidationRuleCode =
  | 'REVIEW_AUTHOR_REVIEWER_INVALID'
  | 'REVIEW_BINDING_MISMATCH'
  | 'REVIEW_CERTIFICATE_INVALID'
  | 'REVIEW_EVIDENCE_INVALID'
  | 'REVIEW_HASH_MISMATCH'
  | 'REVIEW_ORDER_INVALID'
  | 'REVIEW_TIME_INVALID'
  | 'REVIEW_WARNING_DISPOSITION_MISMATCH'

export class ReviewValidationError extends Error {
  readonly code: ReviewValidationRuleCode
  readonly contentKey: string | undefined

  constructor(
    code: ReviewValidationRuleCode,
    message: string,
    contentKey?: string
  ) {
    super(message)
    this.name = 'ReviewValidationError'
    this.code = code
    this.contentKey = contentKey
  }
}

const compareCandidate = (
  left: DuplicateCandidate,
  right: DuplicateCandidate
): number => {
  const keyOrder = compareUnicodeScalars(left.contentKey, right.contentKey)
  if (keyOrder !== 0) return keyOrder
  const kindOrder = compareUnicodeScalars(left.kind, right.kind)
  if (kindOrder !== 0) return kindOrder
  if (left.kind === 'CATALOG_VERSION' && right.kind === 'CATALOG_VERSION') {
    return left.versionNumber - right.versionNumber
  }
  if (left.kind === 'BUNDLE_ITEM' && right.kind === 'BUNDLE_ITEM') {
    return compareUnicodeScalars(left.itemSha256, right.itemSha256)
  }
  return 0
}

const compareWarning = (
  left: DuplicateWarning,
  right: DuplicateWarning
): number => {
  const candidateOrder = compareCandidate(left.candidate, right.candidate)
  return candidateOrder !== 0
    ? candidateOrder
    : compareUnicodeScalars(left.ruleId, right.ruleId)
}

const equalCanonical = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right)

const assertCanonicalOrder = (
  actual: readonly unknown[],
  expected: readonly unknown[],
  contentKey?: string
): void => {
  if (!equalCanonical(actual, expected)) {
    throw new ReviewValidationError(
      'REVIEW_ORDER_INVALID',
      'review artifact array가 canonical order가 아닙니다.',
      contentKey
    )
  }
}

const normalizeSemanticHash = (semantic: PersistedQuestionSemanticV1): string =>
  canonicalJsonSha256(normalizePersistedQuestionSemanticForHash(semantic))

const assertSemanticCanonical = (
  semantic: PersistedQuestionSemanticV1,
  contentKey: string
): void => {
  if (
    !equalCanonical(
      semantic,
      normalizePersistedQuestionSemanticForHash(semantic)
    )
  ) {
    throw new ReviewValidationError(
      'REVIEW_ORDER_INVALID',
      'persisted semantic tagKeys가 canonical order가 아닙니다.',
      contentKey
    )
  }
}

const warningDispositionProjection = (value: DuplicateWarning) => ({
  candidate: value.candidate,
  ruleId: value.ruleId,
  scoreNumerator: value.scoreNumerator,
  scoreDenominator: value.scoreDenominator,
  scoreBasisPoints: value.scoreBasisPoints
})

const assertWarningScore = (
  warning: DuplicateWarning,
  proposed: PersistedQuestionSemanticV1,
  candidate: PersistedQuestionSemanticV1,
  contentKey: string
): void => {
  const score = scoreNearDuplicate(proposed, candidate).find(
    ({ ruleId }) => ruleId === warning.ruleId
  )
  if (
    !score?.matchesThreshold ||
    score.scoreNumerator !== warning.scoreNumerator ||
    score.scoreDenominator !== warning.scoreDenominator ||
    score.scoreBasisPoints !== warning.scoreBasisPoints
  ) {
    throw new ReviewValidationError(
      'REVIEW_BINDING_MISMATCH',
      'duplicate warning score가 evidence body에서 재계산한 값과 다릅니다.',
      contentKey
    )
  }
}

const corpusVersionKey = (contentKey: string, versionNumber: number): string =>
  `${contentKey}\u0000${versionNumber}`

const compareCorpusVersions = (
  left: DuplicateCorpusEvidenceVersionV1,
  right: DuplicateCorpusEvidenceVersionV1
): number => {
  const contentKeyOrder = compareUnicodeScalars(
    left.contentKey,
    right.contentKey
  )
  return contentKeyOrder !== 0
    ? contentKeyOrder
    : left.versionNumber - right.versionNumber
}

interface VerifiedDuplicateSnapshotsV1 {
  readonly corpusByVersion: ReadonlyMap<
    string,
    DuplicateCorpusEvidenceVersionV1
  >
  readonly expectedCatalogWarnings: ReadonlyMap<
    string,
    readonly DuplicateWarning[]
  >
}

const verifyDuplicateSnapshots = (
  validatedBundle: ValidatedBundleV1,
  catalogSnapshot: CatalogSnapshotV1,
  duplicateCorpusSnapshot: DuplicateCorpusEvidenceV1,
  expectedCatalogSha256: string,
  expectedDuplicateCorpusSha256: string
): VerifiedDuplicateSnapshotsV1 => {
  const orderedQuestions = catalogSnapshot.questions.toSorted((left, right) =>
    compareUnicodeScalars(left.contentKey, right.contentKey)
  )
  const orderedVersions = duplicateCorpusSnapshot.versions.toSorted(
    compareCorpusVersions
  )
  assertCanonicalOrder(catalogSnapshot.questions, orderedQuestions)
  assertCanonicalOrder(duplicateCorpusSnapshot.versions, orderedVersions)

  const catalogKeys = catalogSnapshot.questions.map(
    ({ contentKey }) => contentKey
  )
  const corpusKeys = duplicateCorpusSnapshot.versions.map(
    ({ contentKey, versionNumber }) =>
      corpusVersionKey(contentKey, versionNumber)
  )
  if (
    new Set(catalogKeys).size !== catalogKeys.length ||
    new Set(corpusKeys).size !== corpusKeys.length
  ) {
    throw new ReviewValidationError(
      'REVIEW_BINDING_MISMATCH',
      'catalog/duplicate corpus key가 중복되었습니다.'
    )
  }

  const duplicateCorpusDigest = {
    schemaVersion: duplicateCorpusSnapshot.schemaVersion,
    qualityRulesVersion: duplicateCorpusSnapshot.qualityRulesVersion,
    versions: duplicateCorpusSnapshot.versions.map((version) => ({
      contentKey: version.contentKey,
      lifecycleStatus: version.lifecycleStatus,
      versionNumber: version.versionNumber,
      versionStatus: version.versionStatus,
      semanticContentSha256: version.semanticContentSha256,
      duplicateIdentitySha256: version.duplicateIdentitySha256
    }))
  }
  if (
    canonicalJsonSha256(catalogSnapshot) !== expectedCatalogSha256 ||
    canonicalJsonSha256(duplicateCorpusDigest) !== expectedDuplicateCorpusSha256
  ) {
    throw new ReviewValidationError(
      'REVIEW_BINDING_MISMATCH',
      'catalog/duplicate corpus digest가 review artifact와 다릅니다.'
    )
  }

  const catalogByKey = new Map(
    catalogSnapshot.questions.map((question) => [question.contentKey, question])
  )
  const corpusByVersion = new Map(
    duplicateCorpusSnapshot.versions.map((version) => [
      corpusVersionKey(version.contentKey, version.versionNumber),
      version
    ])
  )

  for (const question of catalogSnapshot.questions) {
    const hasVersionNumber = question.currentPublishedVersionNumber !== null
    const hasSemanticHash = question.currentSemanticContentSha256 !== null
    if (hasVersionNumber !== hasSemanticHash) {
      throw new ReviewValidationError(
        'REVIEW_BINDING_MISMATCH',
        'catalog current pointer의 nullable field가 일치하지 않습니다.',
        question.contentKey
      )
    }
    if (question.currentPublishedVersionNumber !== null) {
      const current = corpusByVersion.get(
        corpusVersionKey(
          question.contentKey,
          question.currentPublishedVersionNumber
        )
      )
      if (
        !current ||
        current.versionStatus !== 'PUBLISHED' ||
        current.lifecycleStatus !== question.lifecycleStatus ||
        current.semanticContentSha256 !== question.currentSemanticContentSha256
      ) {
        throw new ReviewValidationError(
          'REVIEW_BINDING_MISMATCH',
          'catalog current pointer가 duplicate corpus와 다릅니다.',
          question.contentKey
        )
      }
    }
  }

  for (const version of duplicateCorpusSnapshot.versions) {
    const question = catalogByKey.get(version.contentKey)
    assertSemanticCanonical(version.content, version.contentKey)
    if (
      !question ||
      question.lifecycleStatus !== version.lifecycleStatus ||
      normalizeSemanticHash(version.content) !==
        version.semanticContentSha256 ||
      sha256Bytes(canonicalDuplicateIdentity(version.content)) !==
        version.duplicateIdentitySha256 ||
      (version.versionStatus === 'PUBLISHED' &&
        question.currentPublishedVersionNumber !== version.versionNumber)
    ) {
      throw new ReviewValidationError(
        'REVIEW_BINDING_MISMATCH',
        'duplicate corpus row가 catalog/body digest와 다릅니다.',
        version.contentKey
      )
    }
  }

  for (const item of validatedBundle.canonicalBundle.items) {
    const catalogQuestion = catalogByKey.get(item.contentKey)
    if (
      (item.intent.kind === 'CREATE' && catalogQuestion !== undefined) ||
      (item.intent.kind === 'NEW_VERSION' &&
        (!catalogQuestion ||
          catalogQuestion.lifecycleStatus !== 'ACTIVE' ||
          catalogQuestion.currentPublishedVersionNumber !==
            item.intent.expectedCurrentVersionNumber ||
          catalogQuestion.currentSemanticContentSha256 !==
            item.intent.expectedCurrentSemanticContentSha256))
    ) {
      throw new ReviewValidationError(
        'REVIEW_BINDING_MISMATCH',
        'bundle intent가 pinned catalog current state와 다릅니다.',
        item.contentKey
      )
    }
  }

  const expectedCatalogWarnings = new Map<string, DuplicateWarning[]>()
  for (const bundleItem of validatedBundle.items) {
    const warnings: DuplicateWarning[] = []
    const proposedIdentity = canonicalDuplicateIdentity(bundleItem.semantic)
    for (const candidate of duplicateCorpusSnapshot.versions) {
      if (candidate.contentKey === bundleItem.contentKey) continue
      if (canonicalDuplicateIdentity(candidate.content) === proposedIdentity) {
        throw new ReviewValidationError(
          'REVIEW_BINDING_MISMATCH',
          'bundle과 catalog 사이 unrelated exact duplicate가 있습니다.',
          bundleItem.contentKey
        )
      }
      for (const score of scoreNearDuplicate(
        bundleItem.semantic,
        candidate.content
      )) {
        if (!score.matchesThreshold) continue
        warnings.push({
          candidate: {
            kind: 'CATALOG_VERSION',
            contentKey: candidate.contentKey,
            versionNumber: candidate.versionNumber,
            duplicateIdentitySha256: candidate.duplicateIdentitySha256
          },
          ruleId: score.ruleId,
          scoreNumerator: score.scoreNumerator,
          scoreDenominator: score.scoreDenominator,
          scoreBasisPoints: score.scoreBasisPoints
        })
      }
    }
    expectedCatalogWarnings.set(
      bundleItem.contentKey,
      warnings.toSorted(compareWarning)
    )
  }

  return { corpusByVersion, expectedCatalogWarnings }
}

const contributorKeyIdentity = (
  registry: ContributorsRegistryV1,
  contributorRef: string,
  role: 'AUTHOR' | 'REVIEWER'
): ContributorsRegistryV1['contributors'][number] =>
  getActiveContributor(registry, contributorRef, role)

export interface PrepareReviewArtifactsInput {
  readonly validatedBundle: ValidatedBundleV1
  readonly reviewPlan: unknown
  readonly reviewEvidence: unknown
  readonly catalogSnapshot: unknown
  readonly duplicateCorpusSnapshot: unknown
  readonly certificate: unknown
  readonly authorSignature: Uint8Array
  readonly now: Date
}

export interface ValidateReviewArtifactsInput
  extends PrepareReviewArtifactsInput {
  readonly reviewerSignature: Uint8Array
}

export interface PreparedReviewArtifactsV1 {
  readonly reviewPlan: ReturnType<typeof duplicateReviewPlanSchema.parse>
  readonly reviewEvidence: ReturnType<
    typeof duplicateReviewEvidenceSchema.parse
  >
  readonly certificate: ReturnType<typeof reviewCertificateSchema.parse>
  readonly duplicateReviewPlanSha256: string
  readonly reviewEvidenceSha256: string
  readonly certificateSha256: string
  readonly certificateItems: readonly {
    readonly contentKey: string
    readonly reviewCertificateItemSha256: string
  }[]
  readonly authorSignatureSha256: string
  readonly authorRef: string
  readonly reviewerRef: string
  readonly reviewerSignaturePayload: Buffer
  readonly reviewerPublicKey: string
  readonly reviewerKeyFingerprintSha256: string
}

export interface ValidatedReviewArtifactsV1 {
  readonly reviewPlan: ReturnType<typeof duplicateReviewPlanSchema.parse>
  readonly reviewEvidence: ReturnType<
    typeof duplicateReviewEvidenceSchema.parse
  >
  readonly certificate: ReturnType<typeof reviewCertificateSchema.parse>
  readonly duplicateReviewPlanSha256: string
  readonly reviewEvidenceSha256: string
  readonly certificateSha256: string
  readonly certificateItems: readonly {
    readonly contentKey: string
    readonly reviewCertificateItemSha256: string
  }[]
  readonly authorSignatureSha256: string
  readonly reviewerSignatureSha256: string
  readonly authorRef: string
  readonly reviewerRef: string
}

export const prepareReviewArtifacts = async ({
  validatedBundle,
  reviewPlan: inputPlan,
  reviewEvidence: inputEvidence,
  catalogSnapshot: inputCatalogSnapshot,
  duplicateCorpusSnapshot: inputDuplicateCorpusSnapshot,
  certificate: inputCertificate,
  authorSignature,
  now
}: PrepareReviewArtifactsInput): Promise<PreparedReviewArtifactsV1> => {
  const trustedNowMs = now.getTime()
  if (!Number.isFinite(trustedNowMs)) {
    throw new ReviewValidationError(
      'REVIEW_TIME_INVALID',
      'trusted now가 유효하지 않습니다.'
    )
  }
  await verifyBundleAuthorSignature({
    validatedBundle,
    signature: authorSignature
  })
  const reviewPlan = duplicateReviewPlanSchema.parse(inputPlan)
  const reviewEvidence = duplicateReviewEvidenceSchema.parse(inputEvidence)
  const catalogSnapshot = catalogDigestSchema.parse(inputCatalogSnapshot)
  const duplicateCorpusSnapshot = duplicateCorpusEvidenceSchema.parse(
    inputDuplicateCorpusSnapshot
  )
  const certificate = reviewCertificateSchema.parse(inputCertificate)

  for (const item of reviewEvidence.items) {
    if (item.base !== null) {
      assertSemanticCanonical(item.base.content, item.contentKey)
    }
    item.warningCandidates.forEach(({ content }) =>
      assertSemanticCanonical(content, item.contentKey)
    )
  }

  const duplicateSnapshots = verifyDuplicateSnapshots(
    validatedBundle,
    catalogSnapshot,
    duplicateCorpusSnapshot,
    reviewEvidence.catalogSha256,
    reviewEvidence.duplicateCorpusSha256
  )

  const planHash = canonicalSelfHash(reviewPlan, 'duplicateReviewPlanSha256')
  const evidenceHash = canonicalSelfHash(reviewEvidence, 'reviewEvidenceSha256')
  if (
    planHash !== reviewPlan.duplicateReviewPlanSha256 ||
    evidenceHash !== reviewEvidence.reviewEvidenceSha256 ||
    reviewPlan.reviewEvidenceSha256 !== evidenceHash
  ) {
    throw new ReviewValidationError(
      'REVIEW_HASH_MISMATCH',
      'review plan/evidence self hash가 일치하지 않습니다.'
    )
  }
  const sharedBindingsValid =
    reviewPlan.bundleSha256 === validatedBundle.bundleSha256 &&
    reviewPlan.policySnapshotSha256 ===
      validatedBundle.bundle.policySnapshotSha256 &&
    reviewEvidence.bundleSha256 === validatedBundle.bundleSha256 &&
    reviewEvidence.policySnapshotSha256 ===
      validatedBundle.bundle.policySnapshotSha256 &&
    reviewEvidence.catalogSha256 === reviewPlan.catalogSha256 &&
    reviewEvidence.duplicateCorpusSha256 === reviewPlan.duplicateCorpusSha256
  if (!sharedBindingsValid) {
    throw new ReviewValidationError(
      'REVIEW_BINDING_MISMATCH',
      'bundle/policy/catalog/corpus binding이 일치하지 않습니다.'
    )
  }

  const orderedPlanItems = reviewPlan.items.toSorted((left, right) =>
    compareUnicodeScalars(left.contentKey, right.contentKey)
  )
  const orderedEvidenceItems = reviewEvidence.items.toSorted((left, right) =>
    compareUnicodeScalars(left.contentKey, right.contentKey)
  )
  const orderedCertificateItems = certificate.items.toSorted((left, right) =>
    compareUnicodeScalars(left.contentKey, right.contentKey)
  )
  assertCanonicalOrder(reviewPlan.items, orderedPlanItems)
  assertCanonicalOrder(reviewEvidence.items, orderedEvidenceItems)
  assertCanonicalOrder(certificate.items, orderedCertificateItems)

  const expectedItemCount = validatedBundle.items.length
  const planKeys = reviewPlan.items.map(({ contentKey }) => contentKey)
  const evidenceKeys = reviewEvidence.items.map(({ contentKey }) => contentKey)
  const certificateKeys = certificate.items.map(({ contentKey }) => contentKey)
  if (
    planKeys.length !== expectedItemCount ||
    evidenceKeys.length !== expectedItemCount ||
    certificateKeys.length !== expectedItemCount ||
    new Set(planKeys).size !== planKeys.length ||
    new Set(evidenceKeys).size !== evidenceKeys.length ||
    new Set(certificateKeys).size !== certificateKeys.length
  ) {
    throw new ReviewValidationError(
      'REVIEW_BINDING_MISMATCH',
      'review artifact item 집합에 누락·추가·중복이 있습니다.'
    )
  }

  if (
    certificate.releaseKey !== validatedBundle.bundle.releaseKey ||
    certificate.releaseRevision !== validatedBundle.bundle.releaseRevision ||
    certificate.bundleSha256 !== validatedBundle.bundleSha256 ||
    certificate.duplicateReviewPlanSha256 !== planHash ||
    certificate.reviewEvidenceSha256 !== evidenceHash
  ) {
    throw new ReviewValidationError(
      'REVIEW_CERTIFICATE_INVALID',
      'certificate release/hash binding이 일치하지 않습니다.'
    )
  }

  const reviewedAt = Date.parse(certificate.reviewedAt)
  const planCreatedAt = Date.parse(reviewPlan.createdAt)
  if (
    reviewedAt < Date.parse(validatedBundle.bundle.createdAt) ||
    reviewedAt < planCreatedAt ||
    reviewedAt - planCreatedAt > SEVEN_DAYS_MS ||
    reviewedAt > trustedNowMs + FIVE_MINUTES_MS
  ) {
    throw new ReviewValidationError(
      'REVIEW_TIME_INVALID',
      'review timestamp/window가 유효하지 않습니다.'
    )
  }

  const planByKey = new Map(
    reviewPlan.items.map((item) => [item.contentKey, item])
  )
  const evidenceByKey = new Map(
    reviewEvidence.items.map((item) => [item.contentKey, item])
  )
  const certificateByKey = new Map(
    certificate.items.map((item) => [item.contentKey, item])
  )
  if (
    planByKey.size !== validatedBundle.items.length ||
    evidenceByKey.size !== validatedBundle.items.length ||
    certificateByKey.size !== validatedBundle.items.length
  ) {
    throw new ReviewValidationError(
      'REVIEW_BINDING_MISMATCH',
      'review artifact item 집합이 bundle과 다릅니다.'
    )
  }

  for (const bundleProjection of validatedBundle.items) {
    const bundleItem = validatedBundle.canonicalBundle.items.find(
      ({ contentKey }) => contentKey === bundleProjection.contentKey
    )
    const planItem = planByKey.get(bundleProjection.contentKey)
    const evidenceItem = evidenceByKey.get(bundleProjection.contentKey)
    const certificateItem = certificateByKey.get(bundleProjection.contentKey)
    if (!bundleItem || !planItem || !evidenceItem || !certificateItem) {
      throw new ReviewValidationError(
        'REVIEW_BINDING_MISMATCH',
        'bundle item의 plan/evidence/certificate row가 없습니다.',
        bundleProjection.contentKey
      )
    }
    if (
      planItem.itemSha256 !== bundleProjection.itemSha256 ||
      evidenceItem.itemSha256 !== bundleProjection.itemSha256 ||
      certificateItem.itemSha256 !== bundleProjection.itemSha256 ||
      certificateItem.semanticContentSha256 !==
        bundleProjection.semanticContentSha256 ||
      !equalCanonical(evidenceItem.proposedContent, bundleItem.content) ||
      certificateItem.authorRef !== validatedBundle.authorRef ||
      Date.parse(bundleItem.provenance.authoredAt) > reviewedAt
    ) {
      throw new ReviewValidationError(
        'REVIEW_BINDING_MISMATCH',
        'item hash/content/provenance binding이 일치하지 않습니다.',
        bundleProjection.contentKey
      )
    }
    const expectsRevisionChecks = bundleItem.intent.kind === 'NEW_VERSION'
    if (expectsRevisionChecks !== (certificateItem.revisionChecks !== null)) {
      throw new ReviewValidationError(
        'REVIEW_CERTIFICATE_INVALID',
        'intent와 revisionChecks matrix가 일치하지 않습니다.',
        bundleProjection.contentKey
      )
    }
    if (bundleItem.intent.kind === 'CREATE') {
      if (evidenceItem.base !== null) {
        throw new ReviewValidationError(
          'REVIEW_EVIDENCE_INVALID',
          'CREATE evidence base는 null이어야 합니다.',
          bundleProjection.contentKey
        )
      }
    } else {
      if (
        evidenceItem.base === null ||
        evidenceItem.base.versionNumber !==
          bundleItem.intent.expectedCurrentVersionNumber ||
        evidenceItem.base.semanticContentSha256 !==
          bundleItem.intent.expectedCurrentSemanticContentSha256 ||
        normalizeSemanticHash(evidenceItem.base.content) !==
          evidenceItem.base.semanticContentSha256 ||
        sha256Bytes(canonicalDuplicateIdentity(evidenceItem.base.content)) !==
          evidenceItem.base.duplicateIdentitySha256 ||
        evidenceItem.base.content.level !== bundleItem.content.level ||
        evidenceItem.base.content.subject !== bundleItem.content.subject ||
        evidenceItem.base.content.questionType !==
          bundleItem.content.questionType
      ) {
        throw new ReviewValidationError(
          'REVIEW_EVIDENCE_INVALID',
          'NEW_VERSION evidence base가 expected current와 다릅니다.',
          bundleProjection.contentKey
        )
      }
      if (
        bundleItem.intent.changeKind === 'PROVENANCE_EVIDENCE_ONLY' &&
        bundleProjection.semanticContentSha256 !==
          bundleItem.intent.expectedCurrentSemanticContentSha256
      ) {
        throw new ReviewValidationError(
          'REVIEW_EVIDENCE_INVALID',
          'PROVENANCE_EVIDENCE_ONLY는 persisted semantic을 바꿀 수 없습니다.',
          bundleProjection.contentKey
        )
      }
    }

    const orderedWarnings = planItem.warnings.toSorted(compareWarning)
    assertCanonicalOrder(
      planItem.warnings,
      orderedWarnings,
      planItem.contentKey
    )
    const warningKeys = planItem.warnings.map((warning) =>
      canonicalizeJson({
        candidate: warning.candidate,
        ruleId: warning.ruleId
      })
    )
    if (new Set(warningKeys).size !== warningKeys.length) {
      throw new ReviewValidationError(
        'REVIEW_WARNING_DISPOSITION_MISMATCH',
        'duplicate warning tuple을 허용하지 않습니다.',
        planItem.contentKey
      )
    }
    const orderedCandidates = evidenceItem.warningCandidates.toSorted(
      (left, right) => compareCandidate(left.candidate, right.candidate)
    )
    assertCanonicalOrder(
      evidenceItem.warningCandidates,
      orderedCandidates,
      planItem.contentKey
    )
    if (planItem.warnings.length !== evidenceItem.warningCandidates.length) {
      throw new ReviewValidationError(
        'REVIEW_WARNING_DISPOSITION_MISMATCH',
        'warning과 evidence candidate 개수가 다릅니다.',
        planItem.contentKey
      )
    }

    for (const [index, warning] of planItem.warnings.entries()) {
      const candidateEvidence = evidenceItem.warningCandidates[index]
      if (
        !candidateEvidence ||
        !equalCanonical(warning.candidate, candidateEvidence.candidate) ||
        warning.candidate.contentKey === planItem.contentKey
      ) {
        throw new ReviewValidationError(
          'REVIEW_WARNING_DISPOSITION_MISMATCH',
          'warning candidate binding이 유효하지 않습니다.',
          planItem.contentKey
        )
      }
      const candidateSemantic = normalizePersistedQuestionSemanticForHash(
        candidateEvidence.content
      )
      const candidateIdentitySha256 = sha256Bytes(
        canonicalDuplicateIdentity(candidateSemantic)
      )
      if (
        candidateIdentitySha256 !==
        candidateEvidence.candidate.duplicateIdentitySha256
      ) {
        throw new ReviewValidationError(
          'REVIEW_EVIDENCE_INVALID',
          'warning candidate duplicate identity가 body와 다릅니다.',
          planItem.contentKey
        )
      }
      if (candidateEvidence.candidate.kind === 'BUNDLE_ITEM') {
        const candidateBundleItem = validatedBundle.canonicalBundle.items.find(
          ({ contentKey }) =>
            contentKey === candidateEvidence.candidate.contentKey
        )
        if (
          !candidateBundleItem ||
          canonicalJsonSha256(
            toContentItemHashInput(
              normalizeContentBundleItemForHash(candidateBundleItem)
            )
          ) !== candidateEvidence.candidate.itemSha256 ||
          !equalCanonical(
            candidateSemantic,
            toPersistedQuestionSemantic(candidateBundleItem.content)
          )
        ) {
          throw new ReviewValidationError(
            'REVIEW_EVIDENCE_INVALID',
            'bundle warning candidate가 같은 bundle item과 다릅니다.',
            planItem.contentKey
          )
        }
      } else {
        const corpusVersion = duplicateSnapshots.corpusByVersion.get(
          corpusVersionKey(
            candidateEvidence.candidate.contentKey,
            candidateEvidence.candidate.versionNumber
          )
        )
        if (
          !corpusVersion ||
          candidateEvidence.candidate.duplicateIdentitySha256 !==
            corpusVersion.duplicateIdentitySha256 ||
          !equalCanonical(candidateSemantic, corpusVersion.content)
        ) {
          throw new ReviewValidationError(
            'REVIEW_EVIDENCE_INVALID',
            'catalog warning candidate가 pinned corpus row와 다릅니다.',
            planItem.contentKey
          )
        }
      }
      assertWarningScore(
        warning,
        bundleProjection.semantic,
        candidateSemantic,
        planItem.contentKey
      )
    }

    const dispositions = certificateItem.nearDuplicateDispositions
    const orderedDispositions = dispositions.toSorted((left, right) =>
      compareWarning(left, right)
    )
    assertCanonicalOrder(dispositions, orderedDispositions, planItem.contentKey)
    if (
      dispositions.length !== planItem.warnings.length ||
      dispositions.some((disposition, index) => {
        const warning = planItem.warnings[index]
        return (
          warning === undefined ||
          !equalCanonical(
            warningDispositionProjection(disposition),
            warningDispositionProjection(warning)
          )
        )
      })
    ) {
      throw new ReviewValidationError(
        'REVIEW_WARNING_DISPOSITION_MISMATCH',
        'near warning과 human disposition이 exact 1:1이 아닙니다.',
        planItem.contentKey
      )
    }
    dispositions.forEach(({ reason }) =>
      assertRetainedMetadataSafe(reason, planItem.contentKey)
    )
  }

  const expectedBundleWarnings = validatedBundle.duplicateWarnings.map(
    (warning) => {
      const candidate = validatedBundle.items.find(
        ({ contentKey }) => contentKey === warning.candidateContentKey
      )
      if (!candidate) {
        throw new ReviewValidationError(
          'REVIEW_BINDING_MISMATCH',
          'intra-bundle warning candidate projection이 없습니다.',
          warning.contentKey
        )
      }
      return {
        contentKey: warning.contentKey,
        warning: {
          candidate: {
            kind: 'BUNDLE_ITEM' as const,
            contentKey: warning.candidateContentKey,
            itemSha256: candidate.itemSha256,
            duplicateIdentitySha256: candidate.duplicateIdentitySha256
          },
          ruleId: warning.score.ruleId,
          scoreNumerator: warning.score.scoreNumerator,
          scoreDenominator: warning.score.scoreDenominator,
          scoreBasisPoints: warning.score.scoreBasisPoints
        }
      }
    }
  )
  for (const planItem of reviewPlan.items) {
    const actualBundleWarnings = planItem.warnings.filter(
      ({ candidate }) => candidate.kind === 'BUNDLE_ITEM'
    )
    const expected = expectedBundleWarnings
      .filter(({ contentKey }) => contentKey === planItem.contentKey)
      .map(({ warning }) => warning)
      .toSorted(compareWarning)
    if (!equalCanonical(actualBundleWarnings, expected)) {
      throw new ReviewValidationError(
        'REVIEW_BINDING_MISMATCH',
        'plan의 intra-bundle warning 집합이 pure scan과 다릅니다.',
        planItem.contentKey
      )
    }
    const actualCatalogWarnings = planItem.warnings.filter(
      ({ candidate }) => candidate.kind === 'CATALOG_VERSION'
    )
    const expectedCatalogWarnings =
      duplicateSnapshots.expectedCatalogWarnings.get(planItem.contentKey) ?? []
    if (!equalCanonical(actualCatalogWarnings, expectedCatalogWarnings)) {
      throw new ReviewValidationError(
        'REVIEW_BINDING_MISMATCH',
        'plan의 catalog warning 집합이 pinned corpus scan과 다릅니다.',
        planItem.contentKey
      )
    }
  }

  const authorRef = validatedBundle.authorRef
  const reviewerRef = certificate.items[0]?.reviewerRef ?? ''
  const registry = validatedBundle.policy.contributorsRegistry
  const author = contributorKeyIdentity(registry, authorRef, 'AUTHOR')
  const reviewer = contributorKeyIdentity(registry, reviewerRef, 'REVIEWER')
  if (
    authorRef === reviewerRef ||
    author.sshPublicKey === reviewer.sshPublicKey ||
    author.sshKeyFingerprintSha256 === reviewer.sshKeyFingerprintSha256 ||
    certificate.items.some((item) => item.reviewerRef !== reviewerRef)
  ) {
    throw new ReviewValidationError(
      'REVIEW_AUTHOR_REVIEWER_INVALID',
      'author/reviewer identity와 key는 서로 달라야 합니다.'
    )
  }
  const certificateSha256 = canonicalJsonSha256(certificate)
  const certificateItems = certificate.items.map((item) => ({
    contentKey: item.contentKey,
    reviewCertificateItemSha256: canonicalJsonSha256(item)
  }))
  const reviewerPayload = reviewerSignaturePayloadSchema.parse({
    schemaVersion: 1,
    role: 'REVIEWER',
    reviewerRef,
    bundleSha256: validatedBundle.bundleSha256,
    duplicateReviewPlanSha256: planHash,
    reviewEvidenceSha256: evidenceHash,
    certificateSha256,
    policySnapshotSha256: validatedBundle.bundle.policySnapshotSha256
  })
  const reviewerSignaturePayload = Buffer.from(
    canonicalizeJson(reviewerPayload),
    'utf8'
  )

  return {
    reviewPlan,
    reviewEvidence,
    certificate,
    duplicateReviewPlanSha256: planHash,
    reviewEvidenceSha256: evidenceHash,
    certificateSha256,
    certificateItems,
    authorSignatureSha256: sha256Bytes(authorSignature),
    authorRef,
    reviewerRef,
    reviewerSignaturePayload,
    reviewerPublicKey: reviewer.sshPublicKey,
    reviewerKeyFingerprintSha256: reviewer.sshKeyFingerprintSha256
  }
}

export const validateReviewArtifacts = async ({
  reviewerSignature,
  ...input
}: ValidateReviewArtifactsInput): Promise<ValidatedReviewArtifactsV1> => {
  const prepared = await prepareReviewArtifacts(input)
  await verifySshSignature({
    payload: prepared.reviewerSignaturePayload,
    signature: reviewerSignature,
    publicKey: prepared.reviewerPublicKey,
    expectedFingerprintSha256: prepared.reviewerKeyFingerprintSha256,
    identity: prepared.reviewerRef,
    namespace: 'nihongo-content-v1'
  })
  const {
    reviewerSignaturePayload: _reviewerSignaturePayload,
    reviewerPublicKey: _reviewerPublicKey,
    reviewerKeyFingerprintSha256: _reviewerKeyFingerprintSha256,
    ...validated
  } = prepared
  return {
    ...validated,
    reviewerSignatureSha256: sha256Bytes(reviewerSignature)
  }
}

export interface ReadReviewArtifactsInput {
  readonly repositoryRoot: string
  readonly reviewPlanPath: string
  readonly reviewEvidencePath: string
  readonly catalogSnapshotPath: string
  readonly duplicateCorpusSnapshotPath: string
  readonly certificatePath: string
  readonly authorSignaturePath: string
  readonly reviewerSignaturePath?: string
}

export const readReviewArtifacts = async ({
  repositoryRoot,
  reviewPlanPath,
  reviewEvidencePath,
  catalogSnapshotPath,
  duplicateCorpusSnapshotPath,
  certificatePath,
  authorSignaturePath,
  reviewerSignaturePath
}: ReadReviewArtifactsInput): Promise<{
  readonly reviewPlan: unknown
  readonly reviewEvidence: unknown
  readonly catalogSnapshot: unknown
  readonly duplicateCorpusSnapshot: unknown
  readonly certificate: unknown
  readonly authorSignature: Buffer
  readonly reviewerSignature: Buffer | null
}> => {
  const [
    reviewPlan,
    reviewEvidence,
    catalogSnapshot,
    duplicateCorpusSnapshot,
    certificate,
    authorSignature,
    reviewerSignature
  ] = await Promise.all([
    readArtifactJson({
      repositoryRoot,
      filePath: reviewPlanPath,
      maximumBytes: REVIEW_PLAN_MAX_BYTES
    }),
    readPrivateArtifactJson({
      repositoryRoot,
      filePath: reviewEvidencePath,
      maximumBytes: REVIEW_EVIDENCE_MAX_BYTES
    }),
    readPrivateArtifactJson({
      repositoryRoot,
      filePath: catalogSnapshotPath,
      maximumBytes: CATALOG_SNAPSHOT_MAX_BYTES
    }),
    readPrivateArtifactJson({
      repositoryRoot,
      filePath: duplicateCorpusSnapshotPath,
      maximumBytes: DUPLICATE_CORPUS_SNAPSHOT_MAX_BYTES
    }),
    readArtifactJson({
      repositoryRoot,
      filePath: certificatePath,
      maximumBytes: REVIEW_CERTIFICATE_MAX_BYTES
    }),
    readArtifactBytes({
      repositoryRoot,
      filePath: authorSignaturePath,
      maximumBytes: 64 * 1024
    }),
    reviewerSignaturePath === undefined
      ? Promise.resolve(null)
      : readArtifactBytes({
          repositoryRoot,
          filePath: reviewerSignaturePath,
          maximumBytes: 64 * 1024
        })
  ])
  return {
    reviewPlan,
    reviewEvidence,
    catalogSnapshot,
    duplicateCorpusSnapshot,
    certificate,
    authorSignature,
    reviewerSignature
  }
}
