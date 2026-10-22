import { canonicalDuplicateIdentity } from '@nihongo/domain/content/validators/v1/duplicates'
import { normalizePersistedQuestionSemanticForHash } from '@nihongo/domain/content/validators/v1/question-content'
import { compareUnicodeScalars } from '@nihongo/domain/content/validators/v1/unicode'
import { canonicalJsonSha256, sha256Bytes } from './canonicalHash.js'
import { persistedQuestionSemanticSchema } from './contentSchemas.js'
import {
  catalogDigestSchema,
  duplicateCorpusEvidenceSchema
} from './reviewSchemas.js'

export interface CatalogQuestionProjectionInputV1 {
  readonly contentKey: string
  readonly lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly currentPublishedVersionNumber: number | null
}

export interface DuplicateCorpusVersionProjectionInputV1 {
  readonly contentKey: string
  readonly lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly versionNumber: number
  readonly versionStatus: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
  readonly content: unknown
}

export interface CatalogAndDuplicateCorpusProjectionInputV1 {
  readonly questions: readonly CatalogQuestionProjectionInputV1[]
  readonly versions: readonly DuplicateCorpusVersionProjectionInputV1[]
}

const corpusKey = (contentKey: string, versionNumber: number): string =>
  `${contentKey}\u0000${versionNumber}`

export const projectCatalogAndDuplicateCorpus = ({
  questions: inputQuestions,
  versions: inputVersions
}: CatalogAndDuplicateCorpusProjectionInputV1) => {
  const questions = inputQuestions.toSorted((left, right) =>
    compareUnicodeScalars(left.contentKey, right.contentKey)
  )
  if (
    new Set(questions.map(({ contentKey }) => contentKey)).size !==
    questions.length
  ) {
    throw new Error('CATALOG_CONTENT_KEY_DUPLICATE')
  }
  const questionByKey = new Map(
    questions.map((question) => [question.contentKey, question])
  )
  const versions = inputVersions
    .map((version) => {
      if (version.versionStatus === 'DRAFT') {
        throw new Error('DUPLICATE_CORPUS_DRAFT_FORBIDDEN')
      }
      const question = questionByKey.get(version.contentKey)
      if (
        question === undefined ||
        question.lifecycleStatus !== version.lifecycleStatus
      ) {
        throw new Error('DUPLICATE_CORPUS_QUESTION_BINDING_INVALID')
      }
      const content = normalizePersistedQuestionSemanticForHash(
        persistedQuestionSemanticSchema.parse(version.content)
      )
      return duplicateCorpusEvidenceSchema.shape.versions.element.parse({
        contentKey: version.contentKey,
        lifecycleStatus: version.lifecycleStatus,
        versionNumber: version.versionNumber,
        versionStatus: version.versionStatus,
        semanticContentSha256: canonicalJsonSha256(content),
        duplicateIdentitySha256: sha256Bytes(
          canonicalDuplicateIdentity(content)
        ),
        content
      })
    })
    .toSorted((left, right) => {
      const contentKeyOrder = compareUnicodeScalars(
        left.contentKey,
        right.contentKey
      )
      return contentKeyOrder !== 0
        ? contentKeyOrder
        : left.versionNumber - right.versionNumber
    })
  const versionKeys = versions.map(({ contentKey, versionNumber }) =>
    corpusKey(contentKey, versionNumber)
  )
  if (new Set(versionKeys).size !== versionKeys.length) {
    throw new Error('DUPLICATE_CORPUS_VERSION_DUPLICATE')
  }
  const versionByKey = new Map(
    versions.map((version) => [
      corpusKey(version.contentKey, version.versionNumber),
      version
    ])
  )
  const catalog = catalogDigestSchema.parse({
    schemaVersion: 1,
    questions: questions.map((question) => {
      if (question.currentPublishedVersionNumber === null) {
        if (
          versions.some(
            (version) =>
              version.contentKey === question.contentKey &&
              version.versionStatus === 'PUBLISHED'
          )
        ) {
          throw new Error('CATALOG_CURRENT_POINTER_INVALID')
        }
        return {
          contentKey: question.contentKey,
          lifecycleStatus: question.lifecycleStatus,
          currentPublishedVersionNumber: null,
          currentSemanticContentSha256: null
        }
      }
      const current = versionByKey.get(
        corpusKey(question.contentKey, question.currentPublishedVersionNumber)
      )
      if (current === undefined || current.versionStatus !== 'PUBLISHED') {
        throw new Error('CATALOG_CURRENT_POINTER_INVALID')
      }
      if (
        versions.some(
          (version) =>
            version.contentKey === question.contentKey &&
            version.versionStatus === 'PUBLISHED' &&
            version.versionNumber !== question.currentPublishedVersionNumber
        )
      ) {
        throw new Error('CATALOG_CURRENT_POINTER_INVALID')
      }
      return {
        contentKey: question.contentKey,
        lifecycleStatus: question.lifecycleStatus,
        currentPublishedVersionNumber: current.versionNumber,
        currentSemanticContentSha256: current.semanticContentSha256
      }
    })
  })
  const duplicateCorpusEvidence = duplicateCorpusEvidenceSchema.parse({
    schemaVersion: 1,
    qualityRulesVersion: 'quality-rules-v1',
    versions
  })
  const duplicateCorpusDigest = {
    schemaVersion: duplicateCorpusEvidence.schemaVersion,
    qualityRulesVersion: duplicateCorpusEvidence.qualityRulesVersion,
    versions: duplicateCorpusEvidence.versions.map(
      ({ content: _content, ...version }) => version
    )
  }
  return {
    catalog,
    catalogSha256: canonicalJsonSha256(catalog),
    duplicateCorpusEvidence,
    duplicateCorpusSha256: canonicalJsonSha256(duplicateCorpusDigest)
  }
}
