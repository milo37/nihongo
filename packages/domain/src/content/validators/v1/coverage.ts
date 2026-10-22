import { isApplicableContentType } from './question-content.js'
import {
  CONTENT_DIFFICULTIES,
  CONTENT_QUESTION_TYPES,
  CONTENT_SUBJECTS,
  JLPT_LEVELS,
  type BundleCoverageSummaryV1,
  type ContentBundleItemV1,
  type ContentLevel,
  type ContentQuestionType,
  type ContentSubject
} from './types.js'

export interface InternalBetaTypeFloorV1 {
  readonly questionType: ContentQuestionType
  readonly count: number
}

export interface InternalBetaSubjectFloorV1 {
  readonly subject: ContentSubject
  readonly count: number
  readonly typeFloors: readonly InternalBetaTypeFloorV1[]
}

export interface InternalBetaLevelFloorV1 {
  readonly level: ContentLevel
  readonly count: number
  readonly subjects: readonly InternalBetaSubjectFloorV1[]
}

const vocabularyFloors = (count: number): InternalBetaSubjectFloorV1 => ({
  subject: 'VOCABULARY',
  count,
  typeFloors: [
    { questionType: 'KANJI_READING', count: count / 5 },
    { questionType: 'ORTHOGRAPHY', count: count / 5 },
    { questionType: 'CONTEXT_VOCABULARY', count: count / 5 },
    { questionType: 'PARAPHRASE', count: count / 5 },
    { questionType: 'WORD_USAGE', count: count / 5 }
  ]
})

const grammarFloors = (count: 20 | 40): InternalBetaSubjectFloorV1 => ({
  subject: 'GRAMMAR',
  count,
  typeFloors:
    count === 40
      ? [
          { questionType: 'GRAMMAR_SELECT', count: 14 },
          { questionType: 'SENTENCE_ORDER', count: 13 },
          { questionType: 'TEXT_GRAMMAR', count: 13 }
        ]
      : [
          { questionType: 'GRAMMAR_SELECT', count: 8 },
          { questionType: 'SENTENCE_ORDER', count: 6 },
          { questionType: 'TEXT_GRAMMAR', count: 6 }
        ]
})

const readingFloors = (
  level: ContentLevel,
  count: 20 | 30
): InternalBetaSubjectFloorV1 => {
  if (level === 'N5' || level === 'N4') {
    return {
      subject: 'READING',
      count,
      typeFloors: [
        { questionType: 'SHORT_READING', count: 10 },
        { questionType: 'INFO_RETRIEVAL', count: 10 }
      ]
    }
  }
  if (level === 'N3') {
    return {
      subject: 'READING',
      count,
      typeFloors: [
        { questionType: 'SHORT_READING', count: 10 },
        { questionType: 'MEDIUM_READING', count: 10 },
        { questionType: 'INFO_RETRIEVAL', count: 10 }
      ]
    }
  }
  if (level === 'N2') {
    return {
      subject: 'READING',
      count,
      typeFloors: [
        { questionType: 'MEDIUM_READING', count: 10 },
        { questionType: 'LONG_READING', count: 10 },
        { questionType: 'INFO_RETRIEVAL', count: 10 }
      ]
    }
  }
  return {
    subject: 'READING',
    count,
    typeFloors: [
      { questionType: 'MEDIUM_READING', count: 5 },
      { questionType: 'LONG_READING', count: 10 },
      { questionType: 'INFO_RETRIEVAL', count: 5 }
    ]
  }
}

export const INTERNAL_BETA_LEVEL_FLOORS: readonly InternalBetaLevelFloorV1[] =
  JLPT_LEVELS.map((level) => {
    const majorCount = level === 'N3' || level === 'N2' ? 40 : 20
    const readingCount = majorCount === 40 ? 30 : 20
    return {
      level,
      count: majorCount * 2 + readingCount,
      subjects: [
        vocabularyFloors(majorCount),
        grammarFloors(majorCount),
        readingFloors(level, readingCount)
      ]
    }
  })

export const summarizeBundleCoverage = (
  items: readonly Pick<ContentBundleItemV1, 'content'>[]
): BundleCoverageSummaryV1 => ({
  schemaVersion: 1,
  scope: 'BUNDLE_ONLY',
  itemCount: items.length,
  byLevelSubject: JLPT_LEVELS.flatMap((level) =>
    CONTENT_SUBJECTS.map((subject) => ({
      level,
      subject,
      count: items.filter(
        ({ content }) => content.level === level && content.subject === subject
      ).length
    }))
  ),
  byLevelSubjectType: JLPT_LEVELS.flatMap((level) =>
    CONTENT_SUBJECTS.flatMap((subject) =>
      CONTENT_QUESTION_TYPES.map((questionType) => ({
        level,
        subject,
        questionType,
        applicable: isApplicableContentType(level, subject, questionType),
        count: items.filter(
          ({ content }) =>
            content.level === level &&
            content.subject === subject &&
            content.questionType === questionType
        ).length
      }))
    )
  ),
  byLevelSubjectDifficulty: JLPT_LEVELS.flatMap((level) =>
    CONTENT_SUBJECTS.flatMap((subject) =>
      CONTENT_DIFFICULTIES.map((difficulty) => ({
        level,
        subject,
        difficulty,
        count: items.filter(
          ({ content }) =>
            content.level === level &&
            content.subject === subject &&
            content.difficulty === difficulty
        ).length
      }))
    )
  )
})
