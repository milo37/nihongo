import {
  compareUnicodeScalars,
  containsForbiddenControlCharacter,
  countUnicodeScalars,
  hasUnicodeEdgeWhitespace,
  isNfc,
  isWellFormedUnicode,
  normalizeOptionComparison,
  normalizeTagKey
} from './unicode.js'
import type {
  ContentBundleItemV1,
  ContentLevel,
  ContentQuestionType,
  ContentSubject,
  OriginalQuestionContentV1,
  PersistedQuestionSemanticV1
} from './types.js'

const QUESTION_TYPES_BY_SUBJECT: Readonly<
  Record<ContentSubject, readonly ContentQuestionType[]>
> = {
  VOCABULARY: [
    'KANJI_READING',
    'ORTHOGRAPHY',
    'CONTEXT_VOCABULARY',
    'PARAPHRASE',
    'WORD_USAGE'
  ],
  GRAMMAR: ['GRAMMAR_SELECT', 'SENTENCE_ORDER', 'TEXT_GRAMMAR'],
  READING: ['SHORT_READING', 'MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL']
}

const READING_TYPES_BY_LEVEL: Readonly<
  Record<ContentLevel, readonly ContentQuestionType[]>
> = {
  N5: ['SHORT_READING', 'INFO_RETRIEVAL'],
  N4: ['SHORT_READING', 'INFO_RETRIEVAL'],
  N3: ['SHORT_READING', 'MEDIUM_READING', 'INFO_RETRIEVAL'],
  N2: ['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL'],
  N1: ['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL']
}

export type ContentValidationRuleCode =
  | 'CONTENT_CONTROL_CHARACTER'
  | 'CONTENT_EDGE_WHITESPACE'
  | 'CONTENT_LENGTH'
  | 'CONTENT_NFC'
  | 'CONTENT_OPTION_KEYS'
  | 'CONTENT_OPTION_UNIQUE'
  | 'CONTENT_PASSAGE_MATRIX'
  | 'CONTENT_RATIONALE_MATRIX'
  | 'CONTENT_TAG_DUPLICATE'
  | 'CONTENT_TYPE_MATRIX'
  | 'CONTENT_UNICODE'

export interface ContentValidationIssue {
  readonly ruleCode: ContentValidationRuleCode
  readonly field: string
}

export const isQuestionTypeAllowedForSubject = (
  subject: ContentSubject,
  questionType: ContentQuestionType
): boolean => QUESTION_TYPES_BY_SUBJECT[subject].includes(questionType)

export const isApplicableContentType = (
  level: ContentLevel,
  subject: ContentSubject,
  questionType: ContentQuestionType
): boolean => {
  if (!isQuestionTypeAllowedForSubject(subject, questionType)) return false
  return (
    subject !== 'READING' ||
    READING_TYPES_BY_LEVEL[level].includes(questionType)
  )
}

const validateText = (
  value: string,
  field: string,
  minimum: number,
  maximum: number,
  issues: ContentValidationIssue[],
  allowLineFeed = false
): void => {
  if (!isWellFormedUnicode(value)) {
    issues.push({ field, ruleCode: 'CONTENT_UNICODE' })
    return
  }
  if (!isNfc(value)) issues.push({ field, ruleCode: 'CONTENT_NFC' })
  if (hasUnicodeEdgeWhitespace(value)) {
    issues.push({ field, ruleCode: 'CONTENT_EDGE_WHITESPACE' })
  }
  if (
    containsForbiddenControlCharacter(value) ||
    (!allowLineFeed && value.includes('\n'))
  ) {
    issues.push({ field, ruleCode: 'CONTENT_CONTROL_CHARACTER' })
  }
  const length = countUnicodeScalars(value)
  if (length < minimum || length > maximum) {
    issues.push({ field, ruleCode: 'CONTENT_LENGTH' })
  }
}

export const validateOriginalQuestionContent = (
  content: OriginalQuestionContentV1
): readonly ContentValidationIssue[] => {
  const issues: ContentValidationIssue[] = []

  if (
    !isApplicableContentType(
      content.level,
      content.subject,
      content.questionType
    )
  ) {
    issues.push({ field: 'questionType', ruleCode: 'CONTENT_TYPE_MATRIX' })
  }

  const passageRequired = content.subject === 'READING'
  const passageAllowed =
    passageRequired || content.questionType === 'TEXT_GRAMMAR'
  if (
    (passageRequired && content.passage === null) ||
    (!passageAllowed && content.passage !== null)
  ) {
    issues.push({ field: 'passage', ruleCode: 'CONTENT_PASSAGE_MATRIX' })
  }
  if (content.passage !== null) {
    validateText(content.passage, 'passage', 1, 5000, issues, true)
  }

  validateText(content.questionText, 'questionText', 1, 1000, issues, true)
  validateText(content.explanationKo, 'explanationKo', 1, 2000, issues, true)
  if (content.explanationJa !== null) {
    validateText(content.explanationJa, 'explanationJa', 1, 2000, issues, true)
  }

  const expectedKeys = ['1', '2', '3', '4']
  if (content.options.some(({ key }, index) => key !== expectedKeys[index])) {
    issues.push({ field: 'options', ruleCode: 'CONTENT_OPTION_KEYS' })
  }

  const normalizedOptions = new Set<string>()
  for (const [index, option] of content.options.entries()) {
    validateText(option.text, `options.${index}.text`, 1, 500, issues)
    const normalized = normalizeOptionComparison(option.text)
    if (normalizedOptions.has(normalized)) {
      issues.push({ field: 'options', ruleCode: 'CONTENT_OPTION_UNIQUE' })
    }
    normalizedOptions.add(normalized)
  }

  for (const key of expectedKeys as Array<'1' | '2' | '3' | '4'>) {
    const rationale = content.distractorRationalesKo[key]
    if (key === content.correctOptionKey) {
      if (rationale !== null) {
        issues.push({
          field: `distractorRationalesKo.${key}`,
          ruleCode: 'CONTENT_RATIONALE_MATRIX'
        })
      }
    } else if (rationale === null) {
      issues.push({
        field: `distractorRationalesKo.${key}`,
        ruleCode: 'CONTENT_RATIONALE_MATRIX'
      })
    } else {
      validateText(rationale, `distractorRationalesKo.${key}`, 1, 500, issues)
    }
  }

  const normalizedTags = new Set<string>()
  for (const [index, tag] of content.tagKeys.entries()) {
    validateText(tag, `tagKeys.${index}`, 1, 80, issues)
    const normalized = normalizeTagKey(tag)
    if (normalizedTags.has(normalized)) {
      issues.push({ field: 'tagKeys', ruleCode: 'CONTENT_TAG_DUPLICATE' })
    }
    normalizedTags.add(normalized)
  }

  return issues.toSorted((left, right) => {
    const fieldOrder = compareUnicodeScalars(left.field, right.field)
    return fieldOrder !== 0
      ? fieldOrder
      : compareUnicodeScalars(left.ruleCode, right.ruleCode)
  })
}

export const toPersistedQuestionSemantic = (
  content: OriginalQuestionContentV1
): PersistedQuestionSemanticV1 => ({
  level: content.level,
  subject: content.subject,
  questionType: content.questionType,
  difficulty: content.difficulty,
  passage: content.passage,
  questionText: content.questionText,
  options: content.options,
  correctOptionKey: content.correctOptionKey,
  explanationKo: content.explanationKo,
  explanationJa: content.explanationJa,
  tagKeys: content.tagKeys.toSorted(compareUnicodeScalars)
})

export const toContentItemHashInput = (item: ContentBundleItemV1) => ({
  contentKey: item.contentKey,
  intent: item.intent,
  content: item.content,
  provenance: item.provenance
})

export const normalizePersistedQuestionSemanticForHash = (
  semantic: PersistedQuestionSemanticV1
): PersistedQuestionSemanticV1 => ({
  ...semantic,
  tagKeys: semantic.tagKeys.toSorted(compareUnicodeScalars)
})

export const normalizeContentBundleItemForHash = (
  item: ContentBundleItemV1
): ContentBundleItemV1 => ({
  ...item,
  content: {
    ...item.content,
    tagKeys: item.content.tagKeys.toSorted(compareUnicodeScalars)
  }
})

export const normalizeContentBundleForHash = (
  bundle: import('./types.js').ContentBundleV1
): import('./types.js').ContentBundleV1 => ({
  ...bundle,
  items: bundle.items
    .map(normalizeContentBundleItemForHash)
    .toSorted((left, right) =>
      compareUnicodeScalars(left.contentKey, right.contentKey)
    )
})
