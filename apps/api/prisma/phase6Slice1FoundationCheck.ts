import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import { summarizeBundleCoverage } from '@nihongo/domain/content/validators/v1/coverage'
import {
  inspectIntraBundleDuplicates,
  type IntraBundleDuplicateResultV1
} from '@nihongo/domain/content/validators/v1/duplicates'
import { isApplicableContentType } from '@nihongo/domain/content/validators/v1/question-content'
import {
  CONTENT_QUESTION_TYPES,
  CONTENT_SUBJECTS,
  JLPT_LEVELS,
  type ContentBundleItemV1,
  type PersistedQuestionSemanticV1,
  type TagTaxonomyV1
} from '@nihongo/domain/content/validators/v1/types'
import {
  readArtifactBytes,
  readArtifactJson
} from '../src/content/validators/v1/artifactReader.js'
import {
  canonicalJsonSha256,
  sha256Bytes
} from '../src/content/validators/v1/canonicalHash.js'
import {
  contributorsRegistrySchema,
  type ContributorsRegistryV1
} from '../src/content/validators/v1/policySchemas.js'
import {
  qualityRulesSchema,
  tagTaxonomySchema
} from '../src/content/validators/v1/contentSchemas.js'
import { verifyCanonicalLegacyArtifacts } from './phase6Slice1ArtifactCheck.js'
import { projectCanonicalLegacySeedArtifacts } from './phase6Slice1LegacyProjection.js'
import { buildAllQuestionSeeds } from './seedQuestionCatalog.js'

const REPOSITORY_ROOT_URL = new URL('../../../', import.meta.url)

export const FOUNDATION_PUBLIC_PROJECTION_SHA256 =
  'b47f6a84074b4927d8581ddb2ad07008df8544be71b105d9e9818f11c9e9194c'

export const FOUNDATION_INPUT_PATHS_V1 = [
  'content/contributors.v1.json',
  'content/foundation/source-manifest.v1.json',
  'content/legacy/legacy-seed-mapping-manifest.v1.json',
  'content/legacy/legacy-seed-source-manifest.v1.json',
  'content/policies/quality-rules.v1.json',
  'content/releases/legacy-system-seed-v1/1/legacy-seed-manifest.json',
  'content/taxonomy/tags.v1.json'
] as const

export const FOUNDATION_SOURCE_PATHS_V1 = [
  'apps/api/prisma/phase6Slice1ArtifactCheck.ts',
  'apps/api/prisma/phase6Slice1FoundationCheck.ts',
  'apps/api/prisma/phase6Slice1LegacyProjection.ts',
  'apps/api/prisma/seed-data/buildQuestionSeed.ts',
  'apps/api/prisma/seed-data/contentReview.ts',
  'apps/api/prisma/seed-data/id.ts',
  'apps/api/prisma/seed-data/questions/createQuestion.ts',
  'apps/api/prisma/seed-data/questions/index.ts',
  'apps/api/prisma/seed-data/questions/n1.ts',
  'apps/api/prisma/seed-data/questions/n2.ts',
  'apps/api/prisma/seed-data/questions/n3.ts',
  'apps/api/prisma/seed-data/questions/n4.ts',
  'apps/api/prisma/seed-data/questions/n5.ts',
  'apps/api/prisma/seedQuestionCatalog.ts',
  'apps/api/src/content/validators/v1/artifactReader.ts',
  'apps/api/src/content/validators/v1/canonicalHash.ts',
  'apps/api/src/content/validators/v1/contentSchemas.ts',
  'apps/api/src/content/validators/v1/legacySchemas.ts',
  'apps/api/src/content/validators/v1/legacySeedProjector.ts',
  'apps/api/src/content/validators/v1/schemaHelpers.ts',
  'apps/api/src/content/validators/v1/strictJson.ts',
  'apps/web/src/mocks/data/questions/createQuestion.ts',
  'apps/web/src/mocks/data/questions/index.ts',
  'apps/web/src/mocks/data/questions/n1.ts',
  'apps/web/src/mocks/data/questions/n2.ts',
  'apps/web/src/mocks/data/questions/n3.ts',
  'apps/web/src/mocks/data/questions/n4.ts',
  'apps/web/src/mocks/data/questions/n5.ts',
  'packages/domain/src/content/validators/v1/canonical-json.ts',
  'packages/domain/src/content/validators/v1/coverage.ts',
  'packages/domain/src/content/validators/v1/duplicates.ts',
  'packages/domain/src/content/validators/v1/question-content.ts',
  'packages/domain/src/content/validators/v1/types.ts',
  'packages/domain/src/content/validators/v1/unicode.ts',
  'scripts/architecture/workspace-checker.mjs'
] as const

interface FoundationSemanticItemV1 {
  readonly contentKey: string
  readonly content: PersistedQuestionSemanticV1
}

interface FoundationCoverageGapV1 {
  readonly level: PersistedQuestionSemanticV1['level']
  readonly subject: PersistedQuestionSemanticV1['subject']
  readonly questionType: PersistedQuestionSemanticV1['questionType']
}

export interface FoundationCatalogDiagnosticsV1 {
  readonly coverage: {
    readonly applicableCellCount: number
    readonly zeroApplicableCellCount: number
    readonly zeroApplicableCells: readonly FoundationCoverageGapV1[]
  }
  readonly duplicates: {
    readonly exactPairCount: number
    readonly directedWarningCount: number
    readonly undirectedPairCount: number
    readonly warnings: IntraBundleDuplicateResultV1['warnings']
  }
  readonly optionCount: number
  readonly passageCount: number
  readonly sentenceOrderCount: number
  readonly tagReferenceCount: number
  readonly taxonomyTagCount: number
}

export interface Phase6Slice1FoundationCheckResultV1 {
  readonly schemaVersion: 1
  readonly command: 'content:foundation-check'
  readonly status: 'PASS'
  readonly questionCount: 65
  readonly contributorCount: 0
  readonly apiWebPublicProjectionSha256: string
  readonly foundationSourceManifestSha256: string
  readonly runtime: {
    readonly nodeVersion: string
    readonly icuVersion: string
    readonly unicodeVersion: string
  }
  readonly legacy: {
    readonly seedSourceManifestSha256: string
    readonly legacySeedMappingSha256: string
    readonly globalReviewSha256: string
  }
  readonly catalog: FoundationCatalogDiagnosticsV1
}

const EXPECTED_RUNTIME = {
  nodeVersion: '22.23.0',
  icuVersion: '78.2',
  unicodeVersion: '17.0'
} as const

const foundationSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('PHASE6_SLICE1_FOUNDATION_SOURCE_MANIFEST_V1'),
    foundationSourceManifestSha256: z.string().regex(/^[0-9a-f]{64}$/)
  })
  .strict()

const EXPECTED_ZERO_CELLS = new Set([
  'N1/GRAMMAR/SENTENCE_ORDER',
  'N1/READING/MEDIUM_READING',
  'N2/GRAMMAR/SENTENCE_ORDER',
  'N2/READING/LONG_READING',
  'N3/GRAMMAR/SENTENCE_ORDER',
  'N4/GRAMMAR/SENTENCE_ORDER',
  'N5/GRAMMAR/SENTENCE_ORDER'
])

const cellKey = ({
  level,
  subject,
  questionType
}: FoundationCoverageGapV1): string => `${level}/${subject}/${questionType}`

const sha256Json = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

export const createApiPublicProjection = (seeds = buildAllQuestionSeeds()) =>
  seeds.map((question) => ({
    id: question.legacyId,
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    passage: question.passage,
    questionText: question.questionText,
    options: question.options.map(({ text }) => text),
    correctIndex: question.options.findIndex(
      ({ id }) => id === question.correctOptionId
    ),
    explanationKo: question.explanationKo,
    explanationJa: question.explanationJa,
    difficulty: question.difficulty,
    tags: question.tags.map(({ label }) => label)
  }))

export const calculateApiPublicProjectionSha256 = (
  seeds = buildAllQuestionSeeds()
): string => sha256Json(createApiPublicProjection(seeds))

export const assertFoundationContributorState = (
  registry: ContributorsRegistryV1
): void => {
  if (registry.contributors.length !== 0) {
    throw new Error('FOUNDATION_CONTRIBUTORS_MUST_BE_EMPTY')
  }
}

const assertTaxonomy = (
  items: readonly FoundationSemanticItemV1[],
  taxonomy: TagTaxonomyV1
): void => {
  const byKey = new Map(taxonomy.tags.map((tag) => [tag.key, tag]))
  const referenced = new Set<string>()
  for (const { content } of items) {
    for (const tagKey of content.tagKeys) {
      const tag = byKey.get(tagKey)
      if (
        tag === undefined ||
        tag.status !== 'ACTIVE' ||
        !tag.applicableLevels.includes(content.level) ||
        !tag.applicableSubjects.includes(content.subject) ||
        !tag.applicableQuestionTypes.includes(content.questionType)
      ) {
        throw new Error('FOUNDATION_TAXONOMY_BINDING_INVALID')
      }
      referenced.add(tagKey)
    }
  }
  if (referenced.size !== taxonomy.tags.length) {
    throw new Error('FOUNDATION_TAXONOMY_BINDING_INVALID')
  }
}

const toCoverageContent = (
  content: PersistedQuestionSemanticV1
): ContentBundleItemV1['content'] => ({
  ...content,
  distractorRationalesKo: {
    '1': null,
    '2': null,
    '3': null,
    '4': null
  }
})

export const inspectFoundationCatalog = (
  items: readonly FoundationSemanticItemV1[],
  taxonomy: TagTaxonomyV1
): FoundationCatalogDiagnosticsV1 => {
  if (items.length !== 65) throw new Error('FOUNDATION_QUESTION_COUNT_INVALID')
  const duplicates = inspectIntraBundleDuplicates(
    items.map(({ contentKey, content }) => ({
      contentKey,
      content: toCoverageContent(content)
    }))
  )
  if (duplicates.exactPairs.length !== 0) {
    throw new Error('FOUNDATION_EXACT_DUPLICATE')
  }
  assertTaxonomy(items, taxonomy)
  const coverage = summarizeBundleCoverage(
    items.map(({ content }) => ({ content: toCoverageContent(content) }))
  )
  const zeroApplicableCells = coverage.byLevelSubjectType
    .filter(({ applicable, count }) => applicable && count === 0)
    .map(({ level, subject, questionType }) => ({
      level,
      subject,
      questionType
    }))
  const actualZeroCells = new Set(zeroApplicableCells.map(cellKey))
  if (
    actualZeroCells.size !== EXPECTED_ZERO_CELLS.size ||
    [...EXPECTED_ZERO_CELLS].some((key) => !actualZeroCells.has(key))
  ) {
    throw new Error('FOUNDATION_COVERAGE_GAP_DRIFT')
  }
  const expectedSubjectCounts = { VOCABULARY: 5, GRAMMAR: 5, READING: 3 }
  for (const level of JLPT_LEVELS) {
    for (const subject of CONTENT_SUBJECTS) {
      const row = coverage.byLevelSubject.find(
        (candidate) =>
          candidate.level === level && candidate.subject === subject
      )
      if (row?.count !== expectedSubjectCounts[subject]) {
        throw new Error('FOUNDATION_COVERAGE_DISTRIBUTION_INVALID')
      }
    }
  }
  const applicableCellCount = JLPT_LEVELS.flatMap((level) =>
    CONTENT_SUBJECTS.flatMap((subject) =>
      CONTENT_QUESTION_TYPES.filter((questionType) =>
        isApplicableContentType(level, subject, questionType)
      )
    )
  ).length
  const warnings = duplicates.warnings
  if (
    warnings.length !== 2 ||
    warnings.some(
      ({ score }) =>
        score.ruleId !== 'QUESTION_TEXT_EDIT_V1' ||
        score.scoreNumerator !== 22 ||
        score.scoreDenominator !== 24 ||
        score.scoreBasisPoints !== 9166
    )
  ) {
    throw new Error('FOUNDATION_DUPLICATE_DIAGNOSTIC_DRIFT')
  }
  return {
    coverage: {
      applicableCellCount,
      zeroApplicableCellCount: zeroApplicableCells.length,
      zeroApplicableCells
    },
    duplicates: {
      exactPairCount: 0,
      directedWarningCount: warnings.length,
      undirectedPairCount: warnings.length / 2,
      warnings
    },
    optionCount: items.reduce(
      (count, { content }) => count + content.options.length,
      0
    ),
    passageCount: items.filter(({ content }) => content.passage !== null)
      .length,
    sentenceOrderCount: items.filter(
      ({ content }) => content.questionType === 'SENTENCE_ORDER'
    ).length,
    tagReferenceCount: items.reduce(
      (count, { content }) => count + content.tagKeys.length,
      0
    ),
    taxonomyTagCount: taxonomy.tags.length
  }
}

export const calculateFoundationSourceManifestSha256 = async (
  repositoryRoot: string
): Promise<string> => {
  const files = await Promise.all(
    FOUNDATION_SOURCE_PATHS_V1.map(async (repositoryPath) => ({
      repositoryPath,
      sha256: sha256Bytes(
        await readArtifactBytes({
          repositoryRoot,
          filePath: repositoryPath,
          maximumBytes: 2 * 1024 * 1024
        })
      )
    }))
  )
  return canonicalJsonSha256({ schemaVersion: 1, files })
}

export const assertFoundationSourceManifestSha256 = (
  actual: string,
  expected: string
): void => {
  if (actual !== expected) {
    throw new Error('FOUNDATION_SOURCE_MANIFEST_DRIFT')
  }
}

const assertRuntime = (): Phase6Slice1FoundationCheckResultV1['runtime'] => {
  const runtime = {
    nodeVersion: process.versions.node,
    icuVersion: process.versions.icu ?? '',
    unicodeVersion: process.versions.unicode ?? ''
  }
  if (canonicalizeJson(runtime) !== canonicalizeJson(EXPECTED_RUNTIME)) {
    throw new Error('FOUNDATION_RUNTIME_DRIFT')
  }
  return runtime
}

export const runPhase6Slice1FoundationCheck = async (
  repositoryRoot: string
): Promise<Phase6Slice1FoundationCheckResultV1> => {
  const canonicalRoot = await realpath(repositoryRoot)
  const [
    legacy,
    projection,
    taxonomyValue,
    qualityRulesValue,
    registryValue,
    sourceManifestValue
  ] = await Promise.all([
    verifyCanonicalLegacyArtifacts(canonicalRoot),
    projectCanonicalLegacySeedArtifacts(canonicalRoot),
    readArtifactJson({
      repositoryRoot: canonicalRoot,
      filePath: 'content/taxonomy/tags.v1.json',
      maximumBytes: 5 * 1024 * 1024
    }),
    readArtifactJson({
      repositoryRoot: canonicalRoot,
      filePath: 'content/policies/quality-rules.v1.json',
      maximumBytes: 1024 * 1024
    }),
    readArtifactJson({
      repositoryRoot: canonicalRoot,
      filePath: 'content/contributors.v1.json',
      maximumBytes: 1024 * 1024
    }),
    readArtifactJson({
      repositoryRoot: canonicalRoot,
      filePath: 'content/foundation/source-manifest.v1.json',
      maximumBytes: 64 * 1024
    })
  ])
  qualityRulesSchema.parse(qualityRulesValue)
  const taxonomy = tagTaxonomySchema.parse(taxonomyValue)
  const registry = contributorsRegistrySchema.parse(registryValue)
  const sourceManifest =
    foundationSourceManifestSchema.parse(sourceManifestValue)
  assertFoundationContributorState(registry)
  const items = [...projection.semanticByContentKey].map(
    ([contentKey, content]) => ({ contentKey, content })
  )
  const catalog = inspectFoundationCatalog(items, taxonomy)
  if (
    catalog.optionCount !== 260 ||
    catalog.passageCount !== 15 ||
    catalog.tagReferenceCount !== 130 ||
    catalog.taxonomyTagCount !== 108 ||
    catalog.sentenceOrderCount !== 0
  ) {
    throw new Error('FOUNDATION_INVENTORY_DRIFT')
  }
  const apiProjectionSha256 = calculateApiPublicProjectionSha256()
  if (apiProjectionSha256 !== FOUNDATION_PUBLIC_PROJECTION_SHA256) {
    throw new Error('FOUNDATION_API_PUBLIC_PROJECTION_DRIFT')
  }
  const foundationSourceManifestSha256 =
    await calculateFoundationSourceManifestSha256(canonicalRoot)
  assertFoundationSourceManifestSha256(
    foundationSourceManifestSha256,
    sourceManifest.foundationSourceManifestSha256
  )
  return {
    schemaVersion: 1,
    command: 'content:foundation-check',
    status: 'PASS',
    questionCount: 65,
    contributorCount: 0,
    apiWebPublicProjectionSha256: apiProjectionSha256,
    foundationSourceManifestSha256,
    runtime: assertRuntime(),
    legacy: {
      seedSourceManifestSha256: legacy.seedSourceManifestSha256,
      legacySeedMappingSha256: legacy.legacySeedMappingSha256,
      globalReviewSha256: legacy.globalReviewSha256
    },
    catalog
  }
}

const main = async (): Promise<void> => {
  const repositoryRoot = await realpath(fileURLToPath(REPOSITORY_ROOT_URL))
  const result = await runPhase6Slice1FoundationCheck(repositoryRoot)
  process.stdout.write(`${canonicalizeJson(result)}\n`)
}

if (process.argv[1]?.endsWith('phase6Slice1FoundationCheck.ts')) {
  main().catch(() => {
    process.stderr.write(
      '{"code":"CONTENT_FOUNDATION_INVALID","message":"CONTENT_FOUNDATION_INVALID","schemaVersion":1}\n'
    )
    process.exitCode = 2
  })
}
