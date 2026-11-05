interface ContentBundleReleaseHashInputV1 {
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

interface LegacySeedItemHashInputV1 {
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
