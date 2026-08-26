import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { validateBundle } from './bundleValidator.js'
import {
  canonicalJsonBytes,
  canonicalSelfHash,
  sha256Bytes
} from './canonicalHash.js'
import { projectCatalogAndDuplicateCorpus } from './catalogProjector.js'
import { tagTaxonomySchema } from './contentSchemas.js'
import {
  authorSignaturePayloadSchema,
  contributorsRegistrySchema,
  reviewerSignaturePayloadSchema
} from './policySchemas.js'
import { reviewCertificateSchema } from './reviewSchemas.js'
import type { VerifiedPolicySnapshotV1 } from './policyVerifier.js'
import {
  prepareReviewArtifacts,
  validateReviewArtifacts
} from './reviewValidator.js'
import { parseSshEd25519PublicKey } from './sshsigVerifier.js'
import { readArtifactJson } from './artifactReader.js'

const execFileAsync = promisify(execFile)
const POLICY_SHA256 = '0'.repeat(64)
const temporaryRoots: string[] = []
const repositoryRoot = await realpath(
  fileURLToPath(new URL('../../../../../../', import.meta.url))
)

const createTestKey = async (name: string) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `nihongo-review-${name}-`))
  temporaryRoots.push(root)
  await chmod(root, 0o700)
  const keyPath = path.join(root, 'ed25519')
  await execFileAsync('/usr/bin/ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    '',
    '-f',
    keyPath
  ])
  const publicKey = (await readFile(`${keyPath}.pub`, 'utf8')).trimEnd()
  return {
    root,
    keyPath,
    publicKey,
    fingerprint: parseSshEd25519PublicKey(publicKey).fingerprintSha256
  }
}

const signPayload = async (
  key: Awaited<ReturnType<typeof createTestKey>>,
  name: string,
  payload: Uint8Array
): Promise<Buffer> => {
  const payloadPath = path.join(key.root, name)
  await writeFile(payloadPath, payload, { mode: 0o600 })
  await execFileAsync('/usr/bin/ssh-keygen', [
    '-q',
    '-Y',
    'sign',
    '-f',
    key.keyPath,
    '-n',
    'nihongo-content-v1',
    payloadPath
  ])
  return readFile(`${payloadPath}.sig`)
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  )
})

describe('Phase 6 Slice 1 review chain', () => {
  it('binds one parsed evidence view to distinct author and reviewer signatures', async () => {
    const [author, reviewer] = await Promise.all([
      createTestKey('author'),
      createTestKey('reviewer')
    ])
    const contributorsRegistry = contributorsRegistrySchema.parse({
      schemaVersion: 1,
      snapshotRevision: 1,
      contributors: [
        {
          contributorRef: 'fixture-author',
          roles: ['AUTHOR'],
          active: true,
          sshPublicKey: author.publicKey,
          sshKeyFingerprintSha256: author.fingerprint
        },
        {
          contributorRef: 'fixture-reviewer',
          roles: ['REVIEWER'],
          active: true,
          sshPublicKey: reviewer.publicKey,
          sshKeyFingerprintSha256: reviewer.fingerprint
        }
      ]
    })
    const taxonomy = tagTaxonomySchema.parse(
      await readArtifactJson({
        repositoryRoot,
        filePath: 'content/taxonomy/tags.v1.json',
        maximumBytes: 1024 * 1024
      })
    )
    const policy = {
      policySnapshotSha256: POLICY_SHA256,
      contributorsRegistry,
      taxonomy
    } as unknown as VerifiedPolicySnapshotV1
    const bundle = await readArtifactJson({
      repositoryRoot,
      filePath: 'content/fixtures/valid/original-n5-context-bundle.v1.json',
      maximumBytes: 1024 * 1024
    })
    const validatedBundle = validateBundle({
      bundle,
      policy,
      now: new Date('2026-08-25T00:00:00.000Z')
    })
    expect(validatedBundle.bundleSha256).toBe(
      '5ec77f21308d199e8410a42aca11be6242bb71dafba994e8798af57c28c4cfdd'
    )
    const item = validatedBundle.items[0]
    const canonicalItem = validatedBundle.canonicalBundle.items[0]
    expect(item).toBeDefined()
    expect(canonicalItem).toBeDefined()
    if (item === undefined || canonicalItem === undefined) return
    expect(item).toMatchObject({
      semanticContentSha256:
        '8a1505b68ddf15c5f3531a6d5d8556243f910c8fc2bc1467829f79417f688789',
      itemSha256:
        'cc3e907dbdf42746c8c7c155e511755da770cdfd6f419188913a5f4b67c6570e',
      duplicateIdentitySha256:
        'd1e057ff7e86344718d8b799cb9c828962c173a4fd6e564f5041029ebf8612a9'
    })

    const projected = projectCatalogAndDuplicateCorpus({
      questions: [],
      versions: []
    })
    expect(projected.catalogSha256).toBe(
      '4e578d62dd320da0b7348ce78cc874d063e46f5180d167a24e0ec2e30a460b8b'
    )
    expect(projected.duplicateCorpusSha256).toBe(
      'ebeef9edc2ee0fabcda0a77ce53274770974ae7b18d3995924c1a4716645548d'
    )
    const evidenceBase = {
      schemaVersion: 1 as const,
      bundleSha256: validatedBundle.bundleSha256,
      policySnapshotSha256: POLICY_SHA256,
      catalogSha256: projected.catalogSha256,
      duplicateCorpusSha256: projected.duplicateCorpusSha256,
      items: [
        {
          contentKey: item.contentKey,
          itemSha256: item.itemSha256,
          proposedContent: canonicalItem.content,
          base: null,
          warningCandidates: []
        }
      ]
    }
    const reviewEvidence = {
      ...evidenceBase,
      reviewEvidenceSha256: canonicalSelfHash(
        evidenceBase,
        'reviewEvidenceSha256'
      )
    }
    const planBase = {
      schemaVersion: 1 as const,
      bundleSha256: validatedBundle.bundleSha256,
      policySnapshotSha256: POLICY_SHA256,
      catalogSha256: projected.catalogSha256,
      duplicateCorpusSha256: projected.duplicateCorpusSha256,
      reviewEvidenceSha256: reviewEvidence.reviewEvidenceSha256,
      createdAt: '2026-08-25T00:01:00.000Z',
      items: [
        {
          contentKey: item.contentKey,
          itemSha256: item.itemSha256,
          warnings: []
        }
      ]
    }
    const reviewPlan = {
      ...planBase,
      duplicateReviewPlanSha256: canonicalSelfHash(
        planBase,
        'duplicateReviewPlanSha256'
      )
    }
    const certificate = {
      schemaVersion: 1 as const,
      releaseKey: 'phase6-slice1-fixture',
      releaseRevision: 1,
      bundleSha256: validatedBundle.bundleSha256,
      duplicateReviewPlanSha256: reviewPlan.duplicateReviewPlanSha256,
      reviewEvidenceSha256: reviewEvidence.reviewEvidenceSha256,
      reviewedAt: '2026-08-25T00:02:00.000Z',
      items: [
        {
          contentKey: item.contentKey,
          semanticContentSha256: item.semanticContentSha256,
          itemSha256: item.itemSha256,
          authorRef: 'fixture-author',
          reviewerRef: 'fixture-reviewer',
          status: 'APPROVED' as const,
          rubricVersion: 'review-rubric-v1',
          checks: {
            naturalJapanese: true,
            singleCorrectAnswer: true,
            distractorsUnambiguous: true,
            distractorRationalesAccurate: true,
            levelFit: true,
            questionTypeFormatValid: true,
            passageSelfContained: true,
            explanationSufficient: true,
            tagsAccurate: true,
            originalNoCopy: true,
            duplicateReviewComplete: true,
            noPersonalDataOrSecrets: true
          },
          revisionChecks: null,
          nearDuplicateDispositions: []
        }
      ]
    }
    const authorPayload = authorSignaturePayloadSchema.parse({
      schemaVersion: 1,
      role: 'AUTHOR',
      authorRef: 'fixture-author',
      bundleSha256: validatedBundle.bundleSha256,
      policySnapshotSha256: POLICY_SHA256
    })
    const authorSignature = await signPayload(
      author,
      'author-payload.json',
      canonicalJsonBytes(authorPayload)
    )
    const input = {
      validatedBundle,
      reviewPlan,
      reviewEvidence,
      catalogSnapshot: projected.catalog,
      duplicateCorpusSnapshot: projected.duplicateCorpusEvidence,
      certificate,
      authorSignature,
      now: new Date('2026-08-25T00:03:00.000Z')
    }
    const prepared = await prepareReviewArtifacts(input)
    const expectedReviewerPayload = reviewerSignaturePayloadSchema.parse({
      schemaVersion: 1,
      role: 'REVIEWER',
      reviewerRef: 'fixture-reviewer',
      bundleSha256: validatedBundle.bundleSha256,
      duplicateReviewPlanSha256: reviewPlan.duplicateReviewPlanSha256,
      reviewEvidenceSha256: reviewEvidence.reviewEvidenceSha256,
      certificateSha256: prepared.certificateSha256,
      policySnapshotSha256: POLICY_SHA256
    })
    expect(prepared.reviewerSignaturePayload).toEqual(
      canonicalJsonBytes(expectedReviewerPayload)
    )
    const reviewerSignature = await signPayload(
      reviewer,
      'reviewer-payload.json',
      prepared.reviewerSignaturePayload
    )
    const validated = await validateReviewArtifacts({
      ...input,
      reviewerSignature
    })

    expect(validated).toMatchObject({
      duplicateReviewPlanSha256:
        'd24f0fb0360fbc7837b14194c60c11d8d4d38e9c893bf3b0d1c4794deacef85a',
      reviewEvidenceSha256:
        '7176dcd25cb693f240d149de85b8b5d3e0efdecc2c7857f1c0b937f9275729de',
      certificateSha256:
        '45802800283d19e7a9048ec79be6eae194c1a4002d4e51b756c4e20e644e8268',
      authorRef: 'fixture-author',
      reviewerRef: 'fixture-reviewer',
      authorSignatureSha256: sha256Bytes(authorSignature),
      reviewerSignatureSha256: sha256Bytes(reviewerSignature)
    })
    expect(validated.certificateItems).toEqual([
      {
        contentKey: 'original.n5.context.001',
        reviewCertificateItemSha256:
          'a4770027eb5a409c1cc2e7e4b344f4c79e1ab41a3377c2254c7a8222d8db5552'
      }
    ])

    const wrongReviewerSignature = await signPayload(
      author,
      'wrong-reviewer-payload.json',
      prepared.reviewerSignaturePayload
    )
    await expect(
      validateReviewArtifacts({
        ...input,
        reviewerSignature: wrongReviewerSignature
      })
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })

    const tamperedCertificate = {
      ...certificate,
      reviewedAt: '2026-08-25T00:02:01.000Z'
    }
    await expect(
      validateReviewArtifacts({
        ...input,
        certificate: tamperedCertificate,
        reviewerSignature
      })
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })

    expect(
      reviewCertificateSchema.safeParse({
        ...certificate,
        items: certificate.items.map((certificateItem) => ({
          ...certificateItem,
          reviewerRef: 'fixture-author'
        }))
      }).success
    ).toBe(false)

    const sameKeyPolicy = {
      ...policy,
      contributorsRegistry: {
        ...contributorsRegistry,
        contributors: contributorsRegistry.contributors.map((contributor) =>
          contributor.contributorRef === 'fixture-reviewer'
            ? {
                ...contributor,
                sshPublicKey: author.publicKey,
                sshKeyFingerprintSha256: author.fingerprint
              }
            : contributor
        )
      }
    } as VerifiedPolicySnapshotV1
    await expect(
      prepareReviewArtifacts({
        ...input,
        validatedBundle: { ...validatedBundle, policy: sameKeyPolicy }
      })
    ).rejects.toMatchObject({ code: 'REVIEW_AUTHOR_REVIEWER_INVALID' })

    const secondBundleItem = {
      ...validatedBundle.bundle.items[0],
      contentKey: 'original.n5.context.002',
      content: {
        ...validatedBundle.bundle.items[0]?.content,
        options: [
          validatedBundle.bundle.items[0]?.content.options[0],
          { key: '2' as const, text: '見ます' },
          validatedBundle.bundle.items[0]?.content.options[2],
          validatedBundle.bundle.items[0]?.content.options[3]
        ]
      }
    }
    const nearBundle = validateBundle({
      bundle: {
        ...validatedBundle.bundle,
        items: [validatedBundle.bundle.items[0], secondBundleItem]
      },
      policy,
      now: new Date('2026-08-25T00:00:00.000Z')
    })
    const warningsFor = (contentKey: string) =>
      nearBundle.duplicateWarnings
        .filter((warning) => warning.contentKey === contentKey)
        .map((warning) => {
          const candidate = nearBundle.items.find(
            (candidateItem) =>
              candidateItem.contentKey === warning.candidateContentKey
          )
          if (candidate === undefined) {
            throw new Error('fixture warning candidate is missing')
          }
          return {
            candidate: {
              kind: 'BUNDLE_ITEM' as const,
              contentKey: candidate.contentKey,
              itemSha256: candidate.itemSha256,
              duplicateIdentitySha256: candidate.duplicateIdentitySha256
            },
            ruleId: warning.score.ruleId,
            scoreNumerator: warning.score.scoreNumerator,
            scoreDenominator: warning.score.scoreDenominator,
            scoreBasisPoints: warning.score.scoreBasisPoints
          }
        })
    const nearEvidenceBase = {
      schemaVersion: 1 as const,
      bundleSha256: nearBundle.bundleSha256,
      policySnapshotSha256: POLICY_SHA256,
      catalogSha256: projected.catalogSha256,
      duplicateCorpusSha256: projected.duplicateCorpusSha256,
      items: nearBundle.items.map((nearItem) => {
        const bundleItem = nearBundle.canonicalBundle.items.find(
          ({ contentKey }) => contentKey === nearItem.contentKey
        )
        if (bundleItem === undefined) {
          throw new Error('fixture bundle item is missing')
        }
        return {
          contentKey: nearItem.contentKey,
          itemSha256: nearItem.itemSha256,
          proposedContent: bundleItem.content,
          base: null,
          warningCandidates: warningsFor(nearItem.contentKey).map(
            ({ candidate }) => {
              const candidateItem = nearBundle.items.find(
                ({ contentKey }) => contentKey === candidate.contentKey
              )
              if (candidateItem === undefined) {
                throw new Error('fixture candidate content is missing')
              }
              return { candidate, content: candidateItem.semantic }
            }
          )
        }
      })
    }
    const nearEvidence = {
      ...nearEvidenceBase,
      reviewEvidenceSha256: canonicalSelfHash(
        nearEvidenceBase,
        'reviewEvidenceSha256'
      )
    }
    const nearPlanBase = {
      schemaVersion: 1 as const,
      bundleSha256: nearBundle.bundleSha256,
      policySnapshotSha256: POLICY_SHA256,
      catalogSha256: projected.catalogSha256,
      duplicateCorpusSha256: projected.duplicateCorpusSha256,
      reviewEvidenceSha256: nearEvidence.reviewEvidenceSha256,
      createdAt: '2026-08-25T00:01:00.000Z',
      items: nearBundle.items.map((nearItem) => ({
        contentKey: nearItem.contentKey,
        itemSha256: nearItem.itemSha256,
        warnings: warningsFor(nearItem.contentKey)
      }))
    }
    const nearPlan = {
      ...nearPlanBase,
      duplicateReviewPlanSha256: canonicalSelfHash(
        nearPlanBase,
        'duplicateReviewPlanSha256'
      )
    }
    const dispositionReason =
      '서로 다른 학습 목적을 유지하는 문항으로 사람이 직접 검토했습니다.'
    const nearCertificate = {
      schemaVersion: 1 as const,
      releaseKey: 'phase6-slice1-fixture',
      releaseRevision: 1,
      bundleSha256: nearBundle.bundleSha256,
      duplicateReviewPlanSha256: nearPlan.duplicateReviewPlanSha256,
      reviewEvidenceSha256: nearEvidence.reviewEvidenceSha256,
      reviewedAt: '2026-08-25T00:02:00.000Z',
      items: nearBundle.items.map((nearItem) => ({
        contentKey: nearItem.contentKey,
        semanticContentSha256: nearItem.semanticContentSha256,
        itemSha256: nearItem.itemSha256,
        authorRef: 'fixture-author',
        reviewerRef: 'fixture-reviewer',
        status: 'APPROVED' as const,
        rubricVersion: 'review-rubric-v1' as const,
        checks: certificate.items[0]?.checks,
        revisionChecks: null,
        nearDuplicateDispositions: warningsFor(nearItem.contentKey).map(
          (warning) => ({
            ...warning,
            qualityRulesVersion: 'quality-rules-v1' as const,
            decision: 'DISTINCT_LEARNING_OBJECTIVE' as const,
            reviewerRef: 'fixture-reviewer',
            reason: dispositionReason
          })
        )
      }))
    }
    const nearAuthorPayload = authorSignaturePayloadSchema.parse({
      schemaVersion: 1,
      role: 'AUTHOR',
      authorRef: 'fixture-author',
      bundleSha256: nearBundle.bundleSha256,
      policySnapshotSha256: POLICY_SHA256
    })
    const nearAuthorSignature = await signPayload(
      author,
      'near-author-payload.json',
      canonicalJsonBytes(nearAuthorPayload)
    )
    const nearInput = {
      validatedBundle: nearBundle,
      reviewPlan: nearPlan,
      reviewEvidence: nearEvidence,
      catalogSnapshot: projected.catalog,
      duplicateCorpusSnapshot: projected.duplicateCorpusEvidence,
      certificate: nearCertificate,
      authorSignature: nearAuthorSignature,
      now: new Date('2026-08-25T00:03:00.000Z')
    }
    const nearPrepared = await prepareReviewArtifacts(nearInput)
    const nearReviewerSignature = await signPayload(
      reviewer,
      'near-reviewer-payload.json',
      nearPrepared.reviewerSignaturePayload
    )
    await expect(
      validateReviewArtifacts({
        ...nearInput,
        reviewerSignature: nearReviewerSignature
      })
    ).resolves.toMatchObject({
      certificateSha256: nearPrepared.certificateSha256
    })

    const firstNearCertificateItem = nearCertificate.items[0]
    expect(firstNearCertificateItem).toBeDefined()
    if (firstNearCertificateItem === undefined) return
    await expect(
      prepareReviewArtifacts({
        ...nearInput,
        certificate: {
          ...nearCertificate,
          items: [
            {
              ...firstNearCertificateItem,
              nearDuplicateDispositions:
                firstNearCertificateItem.nearDuplicateDispositions.slice(1)
            },
            ...nearCertificate.items.slice(1)
          ]
        }
      })
    ).rejects.toMatchObject({
      code: 'REVIEW_WARNING_DISPOSITION_MISMATCH'
    })
    const lastDisposition =
      firstNearCertificateItem.nearDuplicateDispositions.at(-1)
    expect(lastDisposition).toBeDefined()
    if (lastDisposition === undefined) return
    await expect(
      prepareReviewArtifacts({
        ...nearInput,
        certificate: {
          ...nearCertificate,
          items: [
            {
              ...firstNearCertificateItem,
              nearDuplicateDispositions: [
                ...firstNearCertificateItem.nearDuplicateDispositions,
                lastDisposition
              ]
            },
            ...nearCertificate.items.slice(1)
          ]
        }
      })
    ).rejects.toMatchObject({
      code: 'REVIEW_WARNING_DISPOSITION_MISMATCH'
    })
    await expect(
      validateReviewArtifacts({
        ...nearInput,
        certificate: {
          ...nearCertificate,
          items: nearCertificate.items.map((nearItem) => ({
            ...nearItem,
            nearDuplicateDispositions: nearItem.nearDuplicateDispositions.map(
              (disposition) => ({
                ...disposition,
                decision:
                  disposition.decision === 'DISTINCT_LEARNING_OBJECTIVE'
                    ? ('PEDAGOGICALLY_NECESSARY_VARIANT' as const)
                    : ('DISTINCT_LEARNING_OBJECTIVE' as const)
              })
            )
          }))
        },
        reviewerSignature: nearReviewerSignature
      })
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })
  }, 30_000)
})
