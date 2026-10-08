import { lstat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { z } from 'zod'
import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import { INTERNAL_BETA_LEVEL_FLOORS } from '@nihongo/domain/content/validators/v1/coverage'
import {
  CONTENT_QUESTION_TYPES,
  CONTENT_SUBJECTS,
  JLPT_LEVELS,
  TAG_FAMILIES,
  type ContentQuestionType,
  type ContentSubject,
  type TagFamily
} from '@nihongo/domain/content/validators/v1/types'
import {
  compareUnicodeScalars,
  normalizeTagKey
} from '@nihongo/domain/content/validators/v1/unicode'
import {
  contentBundleSchema,
  internalBetaCoverageSchema,
  tagTaxonomySchema
} from '../src/content/validators/v1/contentSchemas.js'
import { readArtifactJson } from '../src/content/validators/v1/artifactReader.js'
import { policyActivationSchema } from '../src/content/validators/v1/policySchemas.js'
import {
  duplicateReviewPlanSchema,
  releaseApprovalReceiptSchema,
  reviewCertificateSchema
} from '../src/content/validators/v1/reviewSchemas.js'
import { writeTrackedArtifact } from '../src/content/validators/v1/trackedArtifactWriter.js'
import { parseStrictJsonBytes } from '../src/content/validators/v1/strictJson.js'
import { buildAllQuestionSeeds } from './seedQuestionCatalog.js'
import { projectCanonicalLegacySeedArtifacts } from './phase6Slice1LegacyProjection.js'

const REPOSITORY_ROOT_URL = new URL('../../../', import.meta.url)

interface MaterializedJsonOutput {
  readonly relativePath: string
  readonly value: unknown
}

interface PendingMaterializedJsonOutput {
  readonly relativePath: string
  readonly bytes: Buffer
}

const preflightJson = async (
  repositoryRoot: string,
  { relativePath, value }: MaterializedJsonOutput
): Promise<PendingMaterializedJsonOutput | null> => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  const plainValue = parseStrictJsonBytes(bytes)
  try {
    await lstat(path.join(repositoryRoot, relativePath), { bigint: true })
    const existingValue = await readArtifactJson({
      repositoryRoot,
      filePath: relativePath,
      maximumBytes: 50 * 1024 * 1024
    })
    if (canonicalizeJson(existingValue) === canonicalizeJson(plainValue)) {
      return null
    }
    throw new Error('PHASE6_IMMUTABLE_ARTIFACT_DRIFT')
  } catch (error: unknown) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error
    }
  }
  return { relativePath, bytes }
}

const publishJson = async (
  repositoryRoot: string,
  { relativePath, bytes }: PendingMaterializedJsonOutput
): Promise<void> => {
  await writeTrackedArtifact({
    repositoryRoot,
    repositoryPath: relativePath,
    bytes,
    maximumBytes: 50 * 1024 * 1024,
    expectedExistingBytes: null
  })
}

export const writeJsonSet = async (
  repositoryRoot: string,
  outputs: readonly MaterializedJsonOutput[]
): Promise<void> => {
  const pending = (
    await Promise.all(
      outputs.map((output) => preflightJson(repositoryRoot, output))
    )
  ).filter((output): output is PendingMaterializedJsonOutput => output !== null)
  await Promise.all(
    pending.map((output) => publishJson(repositoryRoot, output))
  )
}

export const writeJson = async (
  repositoryRoot: string,
  relativePath: string,
  value: unknown
): Promise<void> => writeJsonSet(repositoryRoot, [{ relativePath, value }])

const orderedSubset = <Value extends string>(
  values: ReadonlySet<Value>,
  canonicalOrder: readonly Value[]
): readonly Value[] => canonicalOrder.filter((value) => values.has(value))

const familyForSubjects = (
  subjects: ReadonlySet<ContentSubject>
): TagFamily => {
  if (subjects.size !== 1) return 'PEDAGOGY'
  if (subjects.has('VOCABULARY')) return 'VOCABULARY'
  if (subjects.has('GRAMMAR')) return 'GRAMMAR'
  return 'READING_SKILL'
}

const main = async (): Promise<void> => {
  const repositoryRoot = await realpath(fileURLToPath(REPOSITORY_ROOT_URL))
  const seeds = buildAllQuestionSeeds()
  const tags = new Map<
    string,
    {
      readonly key: string
      readonly labelKo: string
      readonly levels: Set<(typeof JLPT_LEVELS)[number]>
      readonly subjects: Set<ContentSubject>
      readonly questionTypes: Set<ContentQuestionType>
    }
  >()
  for (const seed of seeds) {
    for (const tag of seed.tags) {
      const key = normalizeTagKey(tag.normalizedName)
      const existing = tags.get(key) ?? {
        key,
        labelKo: tag.label,
        levels: new Set<(typeof JLPT_LEVELS)[number]>(),
        subjects: new Set<ContentSubject>(),
        questionTypes: new Set<ContentQuestionType>()
      }
      if (existing.labelKo !== tag.label) {
        throw new Error('PHASE6_TAG_LABEL_COLLISION')
      }
      existing.levels.add(seed.level)
      existing.subjects.add(seed.subject)
      existing.questionTypes.add(seed.questionType)
      tags.set(key, existing)
    }
  }
  if (tags.size !== 108) throw new Error('PHASE6_TAG_COUNT_INVALID')

  const taxonomy = tagTaxonomySchema.parse({
    schemaVersion: 1,
    taxonomyVersion: 'tags-v1',
    normalizationVersion: 'tag-normalization-v1',
    families: TAG_FAMILIES,
    tags: [...tags.values()]
      .toSorted((left, right) => compareUnicodeScalars(left.key, right.key))
      .map((tag) => ({
        key: tag.key,
        labelKo: tag.labelKo,
        family: familyForSubjects(tag.subjects),
        aliases: [],
        applicableLevels: orderedSubset(tag.levels, JLPT_LEVELS),
        applicableSubjects: orderedSubset(tag.subjects, CONTENT_SUBJECTS),
        applicableQuestionTypes: orderedSubset(
          tag.questionTypes,
          CONTENT_QUESTION_TYPES
        ),
        status: 'ACTIVE'
      }))
  })
  const legacy = await projectCanonicalLegacySeedArtifacts(repositoryRoot)
  const internalBetaCoverage = internalBetaCoverageSchema.parse({
    schemaVersion: 1,
    coverageVersion: 'internal-beta-v1',
    total: 400,
    levelFloors: INTERNAL_BETA_LEVEL_FLOORS,
    difficultyRule: {
      requiredDifficulties: ['EASY', 'NORMAL', 'HARD'],
      minimumCellCountForAllDifficulties: 4,
      preferredCenter: 'NORMAL'
    }
  })
  const generatedSchemas = [
    [
      'content/schema/content-bundle.schema.v1.json',
      z.toJSONSchema(contentBundleSchema, { target: 'draft-7' })
    ],
    [
      'content/review/duplicate-review-plan.schema.v1.json',
      z.toJSONSchema(duplicateReviewPlanSchema, { target: 'draft-7' })
    ],
    [
      'content/review/review-certificate.schema.v1.json',
      z.toJSONSchema(reviewCertificateSchema, { target: 'draft-7' })
    ],
    [
      'content/review/release-approval-receipt.schema.v1.json',
      z.toJSONSchema(releaseApprovalReceiptSchema, { target: 'draft-7' })
    ],
    [
      'content/policies/policy-activation.schema.v1.json',
      z.toJSONSchema(policyActivationSchema, { target: 'draft-7' })
    ]
  ] as const

  await writeJsonSet(repositoryRoot, [
    { relativePath: 'content/taxonomy/tags.v1.json', value: taxonomy },
    {
      relativePath: 'content/coverage/internal-beta.v1.json',
      value: internalBetaCoverage
    },
    {
      relativePath: 'content/legacy/legacy-seed-source-manifest.v1.json',
      value: legacy.sourceManifest
    },
    {
      relativePath: 'content/legacy/legacy-seed-mapping-manifest.v1.json',
      value: legacy.mappingManifest
    },
    {
      relativePath:
        'content/releases/legacy-system-seed-v1/1/legacy-seed-manifest.json',
      value: legacy.manifest
    },
    ...generatedSchemas.map(([relativePath, schema]) => ({
      relativePath,
      value: schema
    }))
  ])

  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      command: 'content:materialize-slice1',
      status: 'PASS',
      questionCount: legacy.manifest.items.length,
      tagCount: taxonomy.tags.length,
      seedSourceManifestSha256: legacy.sourceManifest.seedSourceManifestSha256,
      legacySeedMappingSha256: legacy.mappingManifest.legacySeedMappingSha256
    })}\n`
  )
}

if (process.argv[1]?.endsWith('phase6Slice1ArtifactMaterializer.ts')) {
  main().catch(() => {
    process.stdout.write(
      '{"schemaVersion":1,"command":"content:materialize-slice1","status":"ERROR","ruleCode":"CONTENT_MATERIALIZATION_FAILED"}\n'
    )
    process.exitCode = 1
  })
}
