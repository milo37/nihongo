export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
export type ContentLevel = (typeof JLPT_LEVELS)[number]

export const CONTENT_SUBJECTS = ['VOCABULARY', 'GRAMMAR', 'READING'] as const
export type ContentSubject = (typeof CONTENT_SUBJECTS)[number]

export const CONTENT_QUESTION_TYPES = [
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
] as const
export type ContentQuestionType = (typeof CONTENT_QUESTION_TYPES)[number]

export const CONTENT_DIFFICULTIES = ['EASY', 'NORMAL', 'HARD'] as const
export type ContentDifficulty = (typeof CONTENT_DIFFICULTIES)[number]

export const CONTENT_OPTION_KEYS = ['1', '2', '3', '4'] as const
export type ContentOptionKey = (typeof CONTENT_OPTION_KEYS)[number]

export const TAG_FAMILIES = [
  'FORM',
  'GRAMMAR',
  'VOCABULARY',
  'READING_SKILL',
  'TOPIC',
  'PEDAGOGY'
] as const
export type TagFamily = (typeof TAG_FAMILIES)[number]

export interface ContentOptionV1 {
  readonly key: ContentOptionKey
  readonly text: string
}

export interface OriginalQuestionContentV1 {
  readonly level: ContentLevel
  readonly subject: ContentSubject
  readonly questionType: ContentQuestionType
  readonly difficulty: ContentDifficulty
  readonly passage: string | null
  readonly questionText: string
  readonly options: readonly [
    ContentOptionV1,
    ContentOptionV1,
    ContentOptionV1,
    ContentOptionV1
  ]
  readonly correctOptionKey: ContentOptionKey
  readonly explanationKo: string
  readonly explanationJa: string | null
  readonly tagKeys: readonly string[]
  readonly distractorRationalesKo: Readonly<
    Record<ContentOptionKey, string | null>
  >
}

export interface PersistedQuestionSemanticV1 {
  readonly level: ContentLevel
  readonly subject: ContentSubject
  readonly questionType: ContentQuestionType
  readonly difficulty: ContentDifficulty
  readonly passage: string | null
  readonly questionText: string
  readonly options: readonly [
    ContentOptionV1,
    ContentOptionV1,
    ContentOptionV1,
    ContentOptionV1
  ]
  readonly correctOptionKey: ContentOptionKey
  readonly explanationKo: string
  readonly explanationJa: string | null
  readonly tagKeys: readonly string[]
}

export interface OriginalContentProvenanceV1 {
  readonly sourceType: 'ORIGINAL'
  readonly authorRef: string
  readonly creationMethod: 'HUMAN'
  readonly rightsAttestation: 'ORIGINAL_NO_COPY'
  readonly authoredAt: string
  readonly sourceNote: string
}

export type ContentBundleIntentV1 =
  | {
      readonly kind: 'CREATE'
      readonly expectedCurrentVersionNumber: null
      readonly expectedCurrentSemanticContentSha256: null
    }
  | {
      readonly kind: 'NEW_VERSION'
      readonly expectedCurrentVersionNumber: number
      readonly expectedCurrentSemanticContentSha256: string
      readonly changeKind:
        | 'TYPO_FIX'
        | 'WORDING_CLARIFICATION'
        | 'DISTRACTOR_FIX'
        | 'EXPLANATION_FIX'
        | 'TAG_FIX'
        | 'DIFFICULTY_ADJUSTMENT'
        | 'LEGACY_HUMAN_REAUTHORING'
        | 'PROVENANCE_EVIDENCE_ONLY'
      readonly changeSummary: string
    }

export interface ContentBundleItemV1 {
  readonly contentKey: string
  readonly intent: ContentBundleIntentV1
  readonly content: OriginalQuestionContentV1
  readonly provenance: OriginalContentProvenanceV1
}

export interface ContentBundleV1 {
  readonly schemaVersion: 1
  readonly releaseKey: string
  readonly releaseRevision: number
  readonly title: string
  readonly createdAt: string
  readonly policyVersion: 'original-content-v1'
  readonly taxonomyVersion: 'tags-v1'
  readonly reviewRubricVersion: 'review-rubric-v1'
  readonly policySnapshotSha256: string
  readonly items: readonly ContentBundleItemV1[]
}

export interface TagTaxonomyItemV1 {
  readonly key: string
  readonly labelKo: string
  readonly family: TagFamily
  readonly aliases: readonly string[]
  readonly applicableLevels: readonly ContentLevel[]
  readonly applicableSubjects: readonly ContentSubject[]
  readonly applicableQuestionTypes: readonly ContentQuestionType[]
  readonly status: 'ACTIVE' | 'DEPRECATED'
}

export interface TagTaxonomyV1 {
  readonly schemaVersion: 1
  readonly taxonomyVersion: 'tags-v1'
  readonly normalizationVersion: 'tag-normalization-v1'
  readonly families: readonly TagFamily[]
  readonly tags: readonly TagTaxonomyItemV1[]
}

export interface BundleCoverageCellV1 {
  readonly level: ContentLevel
  readonly subject: ContentSubject
  readonly questionType: ContentQuestionType
  readonly applicable: boolean
  readonly count: number
}

export interface BundleCoverageSummaryV1 {
  readonly schemaVersion: 1
  readonly scope: 'BUNDLE_ONLY'
  readonly itemCount: number
  readonly byLevelSubject: readonly {
    readonly level: ContentLevel
    readonly subject: ContentSubject
    readonly count: number
  }[]
  readonly byLevelSubjectType: readonly BundleCoverageCellV1[]
  readonly byLevelSubjectDifficulty: readonly {
    readonly level: ContentLevel
    readonly subject: ContentSubject
    readonly difficulty: ContentDifficulty
    readonly count: number
  }[]
}
