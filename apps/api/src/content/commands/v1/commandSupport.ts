import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { PersistedQuestionSemanticV1 } from '@nihongo/domain/content/validators/v1/types'
import {
  compareUnicodeScalars,
  containsForbiddenControlCharacter,
  normalizeTagKey
} from '@nihongo/domain/content/validators/v1/unicode'
import { verifyCanonicalLegacyArtifacts } from '../../../../prisma/phase6Slice1ArtifactCheck.js'
import { projectCanonicalLegacySeedArtifacts } from '../../../../prisma/phase6Slice1LegacyProjection.js'
import {
  approved308InventorySha256,
  createApproved308TagRequirements,
  readApproved308Supply
} from '../../approved308Supply.js'
import {
  readArtifactBytes,
  readArtifactJson
} from '../../validators/v1/artifactReader.js'
import {
  canonicalJsonSha256,
  sha256Bytes
} from '../../validators/v1/canonicalHash.js'
import {
  contentBundleSchema,
  persistedQuestionSemanticSchema,
  tagTaxonomySchema
} from '../../validators/v1/contentSchemas.js'
import { parseStrictJsonBytes } from '../../validators/v1/strictJson.js'

export const MAX_ANALYSIS_INPUT_BYTES = 2 * 1024 * 1024
export const MAX_ANALYSIS_OUTPUT_BYTES = 128 * 1024
export const MAX_REPORTED_CANDIDATES = 100
export const CONTENT_ANALYSIS_COMMANDS = [
  'check',
  'validate',
  'coverage',
  'duplicates'
] as const
export type ContentAnalysisCommand = (typeof CONTENT_ANALYSIS_COMMANDS)[number]

export class ContentAnalysisError extends Error {
  constructor(
    readonly code:
      | 'CONTENT_COMMAND_UNKNOWN'
      | 'CONTENT_ARGUMENT_INVALID'
      | 'CONTENT_INPUT_INVALID'
      | 'CONTENT_OUTPUT_TOO_LARGE'
  ) {
    super(code)
  }
}

export interface AnalysisItem {
  readonly contentKey: string
  readonly content: PersistedQuestionSemanticV1
}

export interface AnalysisInput {
  readonly scope: 'CURRENT_APPROVED_SOURCES' | 'BUNDLE_ONLY'
  readonly inputSha256: string
  readonly items: readonly AnalysisItem[]
  readonly inventory: {
    readonly foundationQuestionCount: number
    readonly approvedQuestionCount: number
    readonly foundationTaxonomyTagCount: number
    readonly approvedRequiredTagNameCount: number
    readonly approvedRequiredTagTupleCount: number
  } | null
}

export const isContentAnalysisCommand = (
  value: string | undefined
): value is ContentAnalysisCommand =>
  CONTENT_ANALYSIS_COMMANDS.some((command) => command === value)

export const resolveRepositoryRoot = (): Promise<string> =>
  realpath(fileURLToPath(new URL('../../../../../../', import.meta.url)))

const bundlePath = (
  command: ContentAnalysisCommand,
  args: readonly string[]
): string | undefined => {
  if (args.length === 0) return undefined
  const value = args[1]
  if (
    command === 'check' ||
    args.length !== 2 ||
    args[0] !== '--bundle' ||
    value === undefined ||
    value.length === 0 ||
    value.length > 1024 ||
    value.startsWith('--') ||
    containsForbiddenControlCharacter(value) ||
    value.includes('\n')
  ) {
    throw new ContentAnalysisError('CONTENT_ARGUMENT_INVALID')
  }
  return value
}

const orderedItems = (
  items: readonly AnalysisItem[]
): readonly AnalysisItem[] => {
  if (
    items.length === 0 ||
    items.length > 373 ||
    new Set(items.map(({ contentKey }) => contentKey)).size !== items.length
  ) {
    throw new ContentAnalysisError('CONTENT_INPUT_INVALID')
  }
  return items.toSorted((left, right) =>
    compareUnicodeScalars(left.contentKey, right.contentKey)
  )
}

export const loadAnalysisInput = async (
  command: ContentAnalysisCommand,
  args: readonly string[],
  repositoryRoot: string
): Promise<AnalysisInput> => {
  const filePath = bundlePath(command, args)
  if (filePath !== undefined) {
    const bytes = await readArtifactBytes({
      repositoryRoot,
      filePath,
      maximumBytes: MAX_ANALYSIS_INPUT_BYTES
    })
    const bundle = contentBundleSchema.parse(parseStrictJsonBytes(bytes))
    return {
      scope: 'BUNDLE_ONLY',
      inputSha256: sha256Bytes(bytes),
      inventory: null,
      items: orderedItems(
        bundle.items.map(({ contentKey, content }) => {
          const { distractorRationalesKo: _rationales, ...semantic } = content
          return {
            contentKey,
            content: persistedQuestionSemanticSchema.parse(semantic)
          }
        })
      )
    }
  }

  const legacy = await verifyCanonicalLegacyArtifacts(repositoryRoot)
  const projection = await projectCanonicalLegacySeedArtifacts(repositoryRoot)
  const taxonomy = tagTaxonomySchema.parse(
    await readArtifactJson({
      repositoryRoot,
      filePath: 'content/taxonomy/tags.v1.json',
      maximumBytes: MAX_ANALYSIS_INPUT_BYTES
    })
  )
  const foundation = [...projection.semanticByContentKey].map(
    ([contentKey, content]) => ({
      contentKey,
      content: persistedQuestionSemanticSchema.parse(content)
    })
  )
  const tagKeys = new Set(taxonomy.tags.map(({ key }) => key))
  if (
    foundation.length !== 65 ||
    taxonomy.tags.length !== 107 ||
    foundation.some(({ content }) =>
      content.tagKeys.some((key) => !tagKeys.has(key))
    )
  ) {
    throw new ContentAnalysisError('CONTENT_INPUT_INVALID')
  }
  const { items: approvedSources } = readApproved308Supply()
  const approved = approvedSources.map(({ original }) => ({
    contentKey: original.id,
    content: persistedQuestionSemanticSchema.parse({
      level: original.level,
      subject: original.subject,
      questionType: original.questionType,
      difficulty: original.difficulty,
      passage: original.passage ?? null,
      questionText: original.questionText,
      explanationKo: original.explanationKo,
      explanationJa: original.explanationJa,
      options: original.options.map((text, index) => ({
        key: String(index + 1),
        text
      })),
      correctOptionKey: String(original.correctIndex + 1),
      tagKeys: original.tags
        .map(normalizeTagKey)
        .toSorted(compareUnicodeScalars)
    })
  }))
  if (approved.length !== 308)
    throw new ContentAnalysisError('CONTENT_INPUT_INVALID')
  const requirements = createApproved308TagRequirements()
  const items = orderedItems([...foundation, ...approved])
  return {
    scope: 'CURRENT_APPROVED_SOURCES',
    inputSha256: canonicalJsonSha256({
      seedSourceManifestSha256: legacy.seedSourceManifestSha256,
      legacySeedMappingSha256: legacy.legacySeedMappingSha256,
      approvedInventorySha256: approved308InventorySha256,
      taxonomySha256: canonicalJsonSha256(taxonomy),
      semanticSha256: canonicalJsonSha256(items)
    }),
    items,
    inventory: {
      foundationQuestionCount: foundation.length,
      approvedQuestionCount: approved.length,
      foundationTaxonomyTagCount: taxonomy.tags.length,
      approvedRequiredTagNameCount: new Set(
        requirements.map(({ normalizedName }) => normalizedName)
      ).size,
      approvedRequiredTagTupleCount: requirements.length
    }
  }
}
