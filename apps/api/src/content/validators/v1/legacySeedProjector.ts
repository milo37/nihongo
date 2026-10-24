import { compareUnicodeScalars } from '@nihongo/domain/content/validators/v1/unicode'
import type {
  ContentDifficulty,
  ContentLevel,
  ContentOptionKey,
  ContentQuestionType,
  ContentSubject,
  PersistedQuestionSemanticV1
} from '@nihongo/domain/content/validators/v1/types'
import {
  canonicalJsonSha256,
  canonicalSelfHash,
  sha256Bytes
} from './canonicalHash.js'
import { readArtifactBytes } from './artifactReader.js'
import { persistedQuestionSemanticSchema } from './contentSchemas.js'
import type {
  LegacySeedManifestV1,
  LegacySeedMappingManifestV1,
  LegacySeedSourceManifestV1
} from './legacySchemas.js'
import {
  LEGACY_SEED_SOURCE_PATHS,
  legacySeedManifestSchema,
  legacySeedMappingManifestSchema,
  legacySeedSourceManifestSchema
} from './legacySchemas.js'
import { sha256Schema } from './schemaHelpers.js'

export interface LegacyQuestionSeedLike {
  readonly legacyId: string
  readonly questionId: string
  readonly level: ContentLevel
  readonly subject: ContentSubject
  readonly questionType: ContentQuestionType
  readonly passage: string | null
  readonly questionText: string
  readonly correctOptionId: string
  readonly explanationKo: string
  readonly explanationJa: string | null
  readonly difficulty: ContentDifficulty
  readonly options: readonly {
    readonly id: string
    readonly label: ContentOptionKey
    readonly ordinal: number
    readonly text: string
  }[]
  readonly tags: readonly {
    readonly label: string
    readonly normalizedName: string
  }[]
}

export interface LegacySeedProjectionV1 {
  readonly sourceManifest: LegacySeedSourceManifestV1
  readonly mappingManifest: LegacySeedMappingManifestV1
  readonly manifest: LegacySeedManifestV1
  readonly semanticByContentKey: ReadonlyMap<
    string,
    PersistedQuestionSemanticV1
  >
}

export const projectLegacyPersistedSemantic = (
  seed: LegacyQuestionSeedLike
): PersistedQuestionSemanticV1 => {
  const options = seed.options.toSorted(
    (left, right) => left.ordinal - right.ordinal
  )
  if (
    options.length !== 4 ||
    options.some(({ ordinal, label }, index) => {
      const expected = String(index + 1)
      return ordinal !== index + 1 || label !== expected
    })
  ) {
    throw new Error('LEGACY_OPTION_PROJECTION_INVALID')
  }
  const correct = options.find(({ id }) => id === seed.correctOptionId)
  if (!correct) throw new Error('LEGACY_CORRECT_OPTION_PROJECTION_INVALID')
  const [first, second, third, fourth] = options
  if (!first || !second || !third || !fourth) {
    throw new Error('LEGACY_OPTION_PROJECTION_INVALID')
  }

  const projectedOptions: PersistedQuestionSemanticV1['options'] = [
    { key: first.label, text: first.text },
    { key: second.label, text: second.text },
    { key: third.label, text: third.text },
    { key: fourth.label, text: fourth.text }
  ]

  return {
    level: seed.level,
    subject: seed.subject,
    questionType: seed.questionType,
    difficulty: seed.difficulty,
    passage: seed.passage,
    questionText: seed.questionText,
    options: projectedOptions,
    correctOptionKey: correct.label,
    explanationKo: seed.explanationKo,
    explanationJa: seed.explanationJa,
    tagKeys: seed.tags
      .map(({ normalizedName }) => normalizedName)
      .toSorted(compareUnicodeScalars)
  }
}

const createSourceManifest = async (
  repositoryRoot: string
): Promise<LegacySeedSourceManifestV1> => {
  const files = await Promise.all(
    LEGACY_SEED_SOURCE_PATHS.map(async (repositoryPath) => {
      const bytes = await readArtifactBytes({
        repositoryRoot,
        filePath: repositoryPath,
        maximumBytes: 1024 * 1024
      })
      return {
        repositoryPath,
        byteLength: bytes.byteLength,
        sha256: sha256Bytes(bytes)
      }
    })
  )
  const base = {
    schemaVersion: 1 as const,
    kind: 'LEGACY_SEED_SOURCE_MANIFEST_V1' as const,
    files
  }
  return legacySeedSourceManifestSchema.parse({
    ...base,
    seedSourceManifestSha256: canonicalJsonSha256(base)
  })
}

export const projectLegacySeedArtifacts = async (
  repositoryRoot: string,
  seeds: readonly LegacyQuestionSeedLike[],
  globalReviewSha256: string
): Promise<LegacySeedProjectionV1> => {
  if (seeds.length !== 65) throw new Error('LEGACY_SEED_COUNT_INVALID')
  sha256Schema.parse(globalReviewSha256)
  const ordered = seeds.toSorted((left, right) =>
    compareUnicodeScalars(left.legacyId, right.legacyId)
  )
  const identities = new Set<string>()
  const questionIds = new Set<string>()
  const semanticByContentKey = new Map<string, PersistedQuestionSemanticV1>()

  const mappingBase = {
    schemaVersion: 1 as const,
    kind: 'LEGACY_SEED_MAPPING_MANIFEST_V1' as const,
    items: ordered.map(({ legacyId, questionId }) => {
      if (identities.has(legacyId) || questionIds.has(questionId)) {
        throw new Error('LEGACY_SEED_IDENTITY_DUPLICATE')
      }
      identities.add(legacyId)
      questionIds.add(questionId)
      return { legacySeedId: legacyId, contentKey: legacyId, questionId }
    })
  }
  const mappingManifest = legacySeedMappingManifestSchema.parse({
    ...mappingBase,
    legacySeedMappingSha256: canonicalSelfHash(
      mappingBase,
      'legacySeedMappingSha256'
    )
  })
  const sourceManifest = await createSourceManifest(repositoryRoot)
  const manifestBase = {
    schemaVersion: 1 as const,
    artifactKind: 'LEGACY_SEED_MANIFEST_V1' as const,
    releaseKey: 'legacy-system-seed-v1' as const,
    releaseRevision: 1 as const,
    globalReviewSha256,
    seedSourceManifestSha256: sourceManifest.seedSourceManifestSha256,
    legacySeedMappingSha256: mappingManifest.legacySeedMappingSha256,
    items: ordered.map((seed) => {
      const semantic = persistedQuestionSemanticSchema.parse(
        projectLegacyPersistedSemantic(seed)
      )
      semanticByContentKey.set(seed.legacyId, semantic)
      return {
        contentKey: seed.legacyId,
        semanticContentSha256: canonicalJsonSha256(semantic),
        globalReviewSha256
      }
    })
  }

  return {
    sourceManifest,
    mappingManifest,
    manifest: legacySeedManifestSchema.parse(manifestBase),
    semanticByContentKey
  }
}
