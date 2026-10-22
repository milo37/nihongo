export interface ContentBundleReleaseHashInputV1 {
  readonly schemaVersion: 1
  readonly artifactKind: 'CONTENT_BUNDLE_V1'
  readonly releaseKey: string
  readonly releaseRevision: number
  readonly bundleSha256: string
  readonly certificateSha256: string
  readonly duplicateReviewPlanSha256: string
  readonly reviewEvidenceSha256: string
  readonly authorSignatureSha256: string
  readonly reviewerSignatureSha256: string
  readonly approvalReceiptSha256: string
  readonly approvalOwnerSignatureSha256: string
  readonly policyActivationRevision: number
  readonly policyActivationSha256: string
  readonly policyActivationOwnerSignatureSha256: string
  readonly policySnapshotSha256: string
  readonly policyOwnerSignatureSha256: string
}

export interface LegacySeedReleaseHashInputV1 {
  readonly schemaVersion: 1
  readonly artifactKind: 'LEGACY_SEED_MANIFEST_V1'
  readonly releaseKey: 'legacy-system-seed-v1'
  readonly releaseRevision: 1
  readonly bundleSha256: string
  readonly certificateSha256: null
  readonly duplicateReviewPlanSha256: null
  readonly reviewEvidenceSha256: null
  readonly authorSignatureSha256: null
  readonly reviewerSignatureSha256: null
  readonly approvalReceiptSha256: null
  readonly approvalOwnerSignatureSha256: null
  readonly policyActivationRevision: null
  readonly policyActivationSha256: null
  readonly policyActivationOwnerSignatureSha256: null
  readonly policySnapshotSha256: string
  readonly policyOwnerSignatureSha256: string
}

export type ReleaseHashInputV1 =
  | ContentBundleReleaseHashInputV1
  | LegacySeedReleaseHashInputV1

export interface LegacySeedItemHashInputV1 {
  readonly kind: 'LEGACY_SEED_ITEM_V1'
  readonly contentKey: string
  readonly semanticContentSha256: string
  readonly globalReviewSha256: string
}

export const createContentBundleReleaseHashInput = (
  values: Omit<
    ContentBundleReleaseHashInputV1,
    'artifactKind' | 'schemaVersion'
  >
): ContentBundleReleaseHashInputV1 => ({
  schemaVersion: 1,
  artifactKind: 'CONTENT_BUNDLE_V1',
  releaseKey: values.releaseKey,
  releaseRevision: values.releaseRevision,
  bundleSha256: values.bundleSha256,
  certificateSha256: values.certificateSha256,
  duplicateReviewPlanSha256: values.duplicateReviewPlanSha256,
  reviewEvidenceSha256: values.reviewEvidenceSha256,
  authorSignatureSha256: values.authorSignatureSha256,
  reviewerSignatureSha256: values.reviewerSignatureSha256,
  approvalReceiptSha256: values.approvalReceiptSha256,
  approvalOwnerSignatureSha256: values.approvalOwnerSignatureSha256,
  policyActivationRevision: values.policyActivationRevision,
  policyActivationSha256: values.policyActivationSha256,
  policyActivationOwnerSignatureSha256:
    values.policyActivationOwnerSignatureSha256,
  policySnapshotSha256: values.policySnapshotSha256,
  policyOwnerSignatureSha256: values.policyOwnerSignatureSha256
})

export const createLegacySeedReleaseHashInput = (
  values: Pick<
    LegacySeedReleaseHashInputV1,
    'bundleSha256' | 'policyOwnerSignatureSha256' | 'policySnapshotSha256'
  >
): LegacySeedReleaseHashInputV1 => ({
  schemaVersion: 1,
  artifactKind: 'LEGACY_SEED_MANIFEST_V1',
  releaseKey: 'legacy-system-seed-v1',
  releaseRevision: 1,
  bundleSha256: values.bundleSha256,
  certificateSha256: null,
  duplicateReviewPlanSha256: null,
  reviewEvidenceSha256: null,
  authorSignatureSha256: null,
  reviewerSignatureSha256: null,
  approvalReceiptSha256: null,
  approvalOwnerSignatureSha256: null,
  policyActivationRevision: null,
  policyActivationSha256: null,
  policyActivationOwnerSignatureSha256: null,
  policySnapshotSha256: values.policySnapshotSha256,
  policyOwnerSignatureSha256: values.policyOwnerSignatureSha256
})

export const normalizeReleaseHashInput = (
  input: ReleaseHashInputV1
): ReleaseHashInputV1 => {
  if (input.artifactKind === 'CONTENT_BUNDLE_V1') {
    return createContentBundleReleaseHashInput(input)
  }
  if (input.artifactKind === 'LEGACY_SEED_MANIFEST_V1') {
    return createLegacySeedReleaseHashInput(input)
  }
  throw new Error('RELEASE_ARTIFACT_KIND_INVALID')
}

export const createLegacySeedItemHashInput = (values: {
  readonly contentKey: string
  readonly semanticContentSha256: string
  readonly globalReviewSha256: string
}): LegacySeedItemHashInputV1 => ({
  kind: 'LEGACY_SEED_ITEM_V1',
  contentKey: values.contentKey,
  semanticContentSha256: values.semanticContentSha256,
  globalReviewSha256: values.globalReviewSha256
})
