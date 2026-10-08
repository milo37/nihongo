import { z } from 'zod'
import {
  CONTENT_DIFFICULTIES,
  CONTENT_OPTION_KEYS,
  CONTENT_QUESTION_TYPES,
  CONTENT_SUBJECTS,
  JLPT_LEVELS,
  TAG_FAMILIES
} from '@nihongo/domain/content/validators/v1/types'
import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import { INTERNAL_BETA_LEVEL_FLOORS } from '@nihongo/domain/content/validators/v1/coverage'
import {
  isApplicableContentType,
  validateOriginalQuestionContent
} from '@nihongo/domain/content/validators/v1/question-content'
import {
  compareUnicodeScalars,
  normalizeTagKey
} from '@nihongo/domain/content/validators/v1/unicode'
import {
  contentKeySchema,
  contributorRefSchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  releaseKeySchema,
  sha256Schema,
  unicodeScalarStringSchema,
  utcTimestampSchema
} from './schemaHelpers.js'

export const contentLevelSchema = z.enum(JLPT_LEVELS)
export const contentSubjectSchema = z.enum(CONTENT_SUBJECTS)
export const contentQuestionTypeSchema = z.enum(CONTENT_QUESTION_TYPES)
export const contentDifficultySchema = z.enum(CONTENT_DIFFICULTIES)
export const contentOptionKeySchema = z.enum(CONTENT_OPTION_KEYS)
export const tagFamilySchema = z.enum(TAG_FAMILIES)

export const contentOptionSchema = z
  .object({
    key: contentOptionKeySchema,
    text: unicodeScalarStringSchema(1, 500)
  })
  .strict()

const contentOptionForKeySchema = (key: '1' | '2' | '3' | '4') =>
  z
    .object({
      key: z.literal(key),
      text: unicodeScalarStringSchema(1, 500)
    })
    .strict()

const rationaleSchema = unicodeScalarStringSchema(1, 500)

const questionSemanticShape = {
  level: contentLevelSchema,
  subject: contentSubjectSchema,
  questionType: contentQuestionTypeSchema,
  difficulty: contentDifficultySchema,
  passage: unicodeScalarStringSchema(1, 5000, {
    allowLineFeed: true
  }).nullable(),
  questionText: unicodeScalarStringSchema(1, 1000, {
    allowLineFeed: true
  }),
  options: z
    .tuple([
      contentOptionForKeySchema('1'),
      contentOptionForKeySchema('2'),
      contentOptionForKeySchema('3'),
      contentOptionForKeySchema('4')
    ])
    .meta({ minItems: 4, maxItems: 4 }),
  correctOptionKey: contentOptionKeySchema,
  explanationKo: unicodeScalarStringSchema(1, 2000, {
    allowLineFeed: true
  }),
  explanationJa: unicodeScalarStringSchema(1, 2000, {
    allowLineFeed: true
  }).nullable(),
  tagKeys: z.array(unicodeScalarStringSchema(1, 80)).min(1).max(10)
} as const

const addContentIssues = (
  value: Parameters<typeof validateOriginalQuestionContent>[0],
  context: z.RefinementCtx
): void => {
  for (const issue of validateOriginalQuestionContent(value)) {
    context.addIssue({
      code: 'custom',
      message: issue.ruleCode,
      path: issue.field.split('.')
    })
  }
}

export const originalQuestionContentSchema = z
  .object({
    ...questionSemanticShape,
    distractorRationalesKo: z
      .object({
        '1': rationaleSchema.nullable(),
        '2': rationaleSchema.nullable(),
        '3': rationaleSchema.nullable(),
        '4': rationaleSchema.nullable()
      })
      .strict()
  })
  .strict()
  .superRefine(addContentIssues)

export const persistedQuestionSemanticSchema = z
  .object(questionSemanticShape)
  .strict()
  .superRefine((value, context) => {
    addContentIssues(
      {
        ...value,
        distractorRationalesKo: {
          '1': value.correctOptionKey === '1' ? null : '검증용 근거',
          '2': value.correctOptionKey === '2' ? null : '검증용 근거',
          '3': value.correctOptionKey === '3' ? null : '검증용 근거',
          '4': value.correctOptionKey === '4' ? null : '검증용 근거'
        }
      },
      context
    )
  })

export const originalContentProvenanceSchema = z
  .object({
    sourceType: z.literal('ORIGINAL'),
    authorRef: contributorRefSchema,
    creationMethod: z.literal('HUMAN'),
    rightsAttestation: z.literal('ORIGINAL_NO_COPY'),
    authoredAt: utcTimestampSchema,
    sourceNote: unicodeScalarStringSchema(10, 500)
  })
  .strict()

export const createIntentSchema = z
  .object({
    kind: z.literal('CREATE'),
    expectedCurrentVersionNumber: z.null(),
    expectedCurrentSemanticContentSha256: z.null()
  })
  .strict()

export const newVersionIntentSchema = z
  .object({
    kind: z.literal('NEW_VERSION'),
    expectedCurrentVersionNumber: positiveSafeIntegerSchema,
    expectedCurrentSemanticContentSha256: sha256Schema,
    changeKind: z.enum([
      'TYPO_FIX',
      'WORDING_CLARIFICATION',
      'DISTRACTOR_FIX',
      'EXPLANATION_FIX',
      'TAG_FIX',
      'DIFFICULTY_ADJUSTMENT',
      'LEGACY_HUMAN_REAUTHORING',
      'PROVENANCE_EVIDENCE_ONLY'
    ]),
    changeSummary: unicodeScalarStringSchema(1, 500)
  })
  .strict()

export const contentBundleItemSchema = z
  .object({
    contentKey: contentKeySchema,
    intent: z.discriminatedUnion('kind', [
      createIntentSchema,
      newVersionIntentSchema
    ]),
    content: originalQuestionContentSchema,
    provenance: originalContentProvenanceSchema
  })
  .strict()

export const contentBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseKey: releaseKeySchema,
    releaseRevision: positiveSafeIntegerSchema,
    title: unicodeScalarStringSchema(1, 120),
    createdAt: utcTimestampSchema,
    policyVersion: z.literal('original-content-v1'),
    taxonomyVersion: z.literal('tags-v1'),
    reviewRubricVersion: z.literal('review-rubric-v1'),
    policySnapshotSha256: sha256Schema,
    items: z.array(contentBundleItemSchema).min(1).max(25)
  })
  .strict()
  .superRefine((value, context) => {
    const contentKeys = new Set<string>()
    const authorRefs = new Set<string>()
    const createdAt = Date.parse(value.createdAt)
    for (const [index, item] of value.items.entries()) {
      if (contentKeys.has(item.contentKey)) {
        context.addIssue({
          code: 'custom',
          message: 'BUNDLE_CONTENT_KEY_DUPLICATE',
          path: ['items', index, 'contentKey']
        })
      }
      contentKeys.add(item.contentKey)
      authorRefs.add(item.provenance.authorRef)
      if (Date.parse(item.provenance.authoredAt) > createdAt) {
        context.addIssue({
          code: 'custom',
          message: 'PROVENANCE_AFTER_BUNDLE',
          path: ['items', index, 'provenance', 'authoredAt']
        })
      }
    }
    if (authorRefs.size !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'BUNDLE_AUTHOR_MUST_BE_SINGLE',
        path: ['items']
      })
    }
  })

export const tagTaxonomyItemSchema = z
  .object({
    key: unicodeScalarStringSchema(1, 80),
    labelKo: unicodeScalarStringSchema(1, 80),
    family: tagFamilySchema,
    aliases: z.array(unicodeScalarStringSchema(1, 80)).max(20),
    applicableLevels: z.array(contentLevelSchema).min(1).max(5),
    applicableSubjects: z.array(contentSubjectSchema).min(1).max(3),
    applicableQuestionTypes: z
      .array(contentQuestionTypeSchema)
      .min(1)
      .max(CONTENT_QUESTION_TYPES.length),
    status: z.enum(['ACTIVE', 'DEPRECATED'])
  })
  .strict()

const isCanonicalSubset = <Value extends string>(
  actual: readonly Value[],
  expectedOrder: readonly Value[]
): boolean =>
  actual.length ===
    expectedOrder.filter((entry) => actual.includes(entry)).length &&
  actual.every(
    (entry, index) =>
      entry ===
      expectedOrder.filter((candidate) => actual.includes(candidate))[index]
  )

export const tagTaxonomySchema = z
  .object({
    schemaVersion: z.literal(1),
    taxonomyVersion: z.literal('tags-v1'),
    normalizationVersion: z.literal('tag-normalization-v1'),
    families: z
      .tuple([
        z.literal('FORM'),
        z.literal('GRAMMAR'),
        z.literal('VOCABULARY'),
        z.literal('READING_SKILL'),
        z.literal('TOPIC'),
        z.literal('PEDAGOGY')
      ])
      .meta({ minItems: 6, maxItems: 6 }),
    tags: z.array(tagTaxonomyItemSchema)
  })
  .strict()
  .superRefine((value, context) => {
    const normalizedSources = new Map<string, string>()
    const orderedTags = value.tags.toSorted((left, right) =>
      compareUnicodeScalars(left.key, right.key)
    )

    for (const [tagIndex, tag] of value.tags.entries()) {
      if (
        tag !== orderedTags[tagIndex] ||
        normalizeTagKey(tag.key) !== tag.key
      ) {
        context.addIssue({
          code: 'custom',
          message: 'TAG_TAXONOMY_KEY_ORDER_OR_NORMALIZATION',
          path: ['tags', tagIndex, 'key']
        })
      }

      const orderedAliases = tag.aliases.toSorted((left, right) =>
        compareUnicodeScalars(normalizeTagKey(left), normalizeTagKey(right))
      )
      if (
        tag.aliases.length !== orderedAliases.length ||
        tag.aliases.some((alias, index) => alias !== orderedAliases[index])
      ) {
        context.addIssue({
          code: 'custom',
          message: 'TAG_TAXONOMY_ALIAS_ORDER',
          path: ['tags', tagIndex, 'aliases']
        })
      }

      for (const [field, valid] of [
        [
          'applicableLevels',
          isCanonicalSubset(tag.applicableLevels, JLPT_LEVELS)
        ],
        [
          'applicableSubjects',
          isCanonicalSubset(tag.applicableSubjects, CONTENT_SUBJECTS)
        ],
        [
          'applicableQuestionTypes',
          isCanonicalSubset(tag.applicableQuestionTypes, CONTENT_QUESTION_TYPES)
        ]
      ] as const) {
        if (valid) continue
        context.addIssue({
          code: 'custom',
          message: 'TAG_TAXONOMY_APPLICABILITY_ORDER',
          path: ['tags', tagIndex, field]
        })
      }

      for (const questionType of tag.applicableQuestionTypes) {
        const hasApplicableCell = tag.applicableLevels.some((level) =>
          tag.applicableSubjects.some((subject) =>
            isApplicableContentType(level, subject, questionType)
          )
        )
        if (!hasApplicableCell) {
          context.addIssue({
            code: 'custom',
            message: 'TAG_TAXONOMY_APPLICABILITY_MATRIX',
            path: ['tags', tagIndex, 'applicableQuestionTypes']
          })
        }
      }

      for (const source of [tag.key, ...tag.aliases]) {
        const normalized = normalizeTagKey(source)
        const existingTarget = normalizedSources.get(normalized)
        if (existingTarget !== undefined) {
          context.addIssue({
            code: 'custom',
            message: 'TAG_TAXONOMY_ALIAS_COLLISION',
            path: ['tags', tagIndex, 'aliases']
          })
        } else {
          normalizedSources.set(normalized, tag.key)
        }
      }
    }
  })

export const qualityRulesSchema = z
  .object({
    schemaVersion: z.literal(1),
    qualityRulesVersion: z.literal('quality-rules-v1'),
    canonicalizationVersion: z.literal('rfc8785-nihongo-v1'),
    duplicateNormalizationVersion: z.literal('duplicate-normalization-v1'),
    exactDuplicateDecision: z.literal('HARD_FAIL'),
    nearDuplicatePairDirection: z.literal('SYMMETRIC_DIRECTED'),
    thresholdsBasisPoints: z
      .object({
        questionPassageTrigram: z.literal(8200),
        questionTextEdit: z.literal(9000),
        readingPassageTrigram: z.literal(9000)
      })
      .strict(),
    itemLimits: z
      .object({
        bundleItemsMax: z.literal(25),
        tagKeysMin: z.literal(1),
        tagKeysMax: z.literal(10),
        nearDuplicateDispositionsMax: z.literal(100)
      })
      .strict()
  })
  .strict()

export const typeFloorSchema = z
  .object({
    questionType: contentQuestionTypeSchema,
    count: positiveSafeIntegerSchema
  })
  .strict()

export const subjectFloorSchema = z
  .object({
    subject: contentSubjectSchema,
    count: positiveSafeIntegerSchema,
    typeFloors: z.array(typeFloorSchema).min(1)
  })
  .strict()

export const levelFloorSchema = z
  .object({
    level: contentLevelSchema,
    count: positiveSafeIntegerSchema,
    subjects: z.array(subjectFloorSchema).length(3)
  })
  .strict()

export const internalBetaCoverageSchema = z
  .object({
    schemaVersion: z.literal(1),
    coverageVersion: z.literal('internal-beta-v1'),
    total: z.literal(400),
    levelFloors: z.array(levelFloorSchema).length(5),
    difficultyRule: z
      .object({
        requiredDifficulties: z
          .tuple([z.literal('EASY'), z.literal('NORMAL'), z.literal('HARD')])
          .meta({ minItems: 3, maxItems: 3 }),
        minimumCellCountForAllDifficulties: z.literal(4),
        preferredCenter: z.literal('NORMAL')
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      canonicalizeJson(value.levelFloors) !==
      canonicalizeJson(INTERNAL_BETA_LEVEL_FLOORS)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'INTERNAL_BETA_FLOORS_MISMATCH',
        path: ['levelFloors']
      })
    }
    const total = value.levelFloors.reduce((sum, row) => sum + row.count, 0)
    if (total !== value.total) {
      context.addIssue({
        code: 'custom',
        message: 'INTERNAL_BETA_TOTAL_MISMATCH',
        path: ['total']
      })
    }
  })

export const bundleCoverageSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.literal('BUNDLE_ONLY'),
    itemCount: nonNegativeSafeIntegerSchema,
    byLevelSubject: z.array(
      z
        .object({
          level: contentLevelSchema,
          subject: contentSubjectSchema,
          count: nonNegativeSafeIntegerSchema
        })
        .strict()
    ),
    byLevelSubjectType: z.array(
      z
        .object({
          level: contentLevelSchema,
          subject: contentSubjectSchema,
          questionType: contentQuestionTypeSchema,
          applicable: z.boolean(),
          count: nonNegativeSafeIntegerSchema
        })
        .strict()
    ),
    byLevelSubjectDifficulty: z.array(
      z
        .object({
          level: contentLevelSchema,
          subject: contentSubjectSchema,
          difficulty: contentDifficultySchema,
          count: nonNegativeSafeIntegerSchema
        })
        .strict()
    )
  })
  .strict()
  .superRefine((value, context) => {
    const expectedLevelSubjects = JLPT_LEVELS.flatMap((level) =>
      CONTENT_SUBJECTS.map((subject) => ({ level, subject }))
    )
    const expectedTypes = JLPT_LEVELS.flatMap((level) =>
      CONTENT_SUBJECTS.flatMap((subject) =>
        CONTENT_QUESTION_TYPES.map((questionType) => ({
          level,
          subject,
          questionType,
          applicable: isApplicableContentType(level, subject, questionType)
        }))
      )
    )
    const expectedDifficulties = JLPT_LEVELS.flatMap((level) =>
      CONTENT_SUBJECTS.flatMap((subject) =>
        CONTENT_DIFFICULTIES.map((difficulty) => ({
          level,
          subject,
          difficulty
        }))
      )
    )
    const levelSubjectOrderValid =
      value.byLevelSubject.length === expectedLevelSubjects.length &&
      value.byLevelSubject.every((row, index) => {
        const expected = expectedLevelSubjects[index]
        return row.level === expected?.level && row.subject === expected.subject
      })
    const typeOrderValid =
      value.byLevelSubjectType.length === expectedTypes.length &&
      value.byLevelSubjectType.every((row, index) => {
        const expected = expectedTypes[index]
        return (
          row.level === expected?.level &&
          row.subject === expected.subject &&
          row.questionType === expected.questionType &&
          row.applicable === expected.applicable
        )
      })
    const difficultyOrderValid =
      value.byLevelSubjectDifficulty.length === expectedDifficulties.length &&
      value.byLevelSubjectDifficulty.every((row, index) => {
        const expected = expectedDifficulties[index]
        return (
          row.level === expected?.level &&
          row.subject === expected.subject &&
          row.difficulty === expected.difficulty
        )
      })
    if (!levelSubjectOrderValid || !typeOrderValid || !difficultyOrderValid) {
      context.addIssue({
        code: 'custom',
        message: 'BUNDLE_COVERAGE_ORDER',
        path: ['byLevelSubject']
      })
    }
    for (const [path, total] of [
      [
        'byLevelSubject',
        value.byLevelSubject.reduce((sum, row) => sum + row.count, 0)
      ],
      [
        'byLevelSubjectType',
        value.byLevelSubjectType.reduce((sum, row) => sum + row.count, 0)
      ],
      [
        'byLevelSubjectDifficulty',
        value.byLevelSubjectDifficulty.reduce((sum, row) => sum + row.count, 0)
      ]
    ] as const) {
      if (total !== value.itemCount) {
        context.addIssue({
          code: 'custom',
          message: 'BUNDLE_COVERAGE_COUNT_MISMATCH',
          path: [path]
        })
      }
    }
  })

export type TagTaxonomyV1 = z.infer<typeof tagTaxonomySchema>
export type QualityRulesV1 = z.infer<typeof qualityRulesSchema>
export type InternalBetaCoverageV1 = z.infer<typeof internalBetaCoverageSchema>
