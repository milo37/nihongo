import type { GetWrongNoteResponse } from '@nihongo/contracts/wrong-note/get-wrong-note'
import { normalizeQuestionTagText } from '@nihongo/contracts/question/get-question'
import {
  compareWrongNoteTagLabels,
  trimWrongNoteTagLabel,
  type WrongNoteSummary
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import {
  getCanonicalQuestionId,
  getQuestionContractIdentity,
  getQuestionVersionFingerprint,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import type { MockCanonicalWrongNoteRecord } from '@mocks/repository/mockDatabase'

const QUESTION_PREVIEW_MAX_LENGTH = 160

export class MockWrongNoteReadIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MockWrongNoteReadIntegrityError'
  }
}

export const createMockWrongNoteQuestionPreview = (
  questionText: string
): string => {
  const characters = [...questionText]

  return characters.length <= QUESTION_PREVIEW_MAX_LENGTH
    ? questionText
    : `${characters.slice(0, QUESTION_PREVIEW_MAX_LENGTH - 3).join('')}...`
}

const toValidatedSortedTagLabels = (tags: readonly string[]): string[] => {
  const labels = new Set<string>()

  for (const tag of tags) {
    const trimmed = trimWrongNoteTagLabel(tag)
    if (tag !== trimmed || trimmed.length === 0 || labels.has(tag)) {
      throw new MockWrongNoteReadIntegrityError(
        'Historical tag labels must be nonempty, exact, unique values without ASCII edge spaces.'
      )
    }
    labels.add(tag)
  }

  return [...labels].toSorted(compareWrongNoteTagLabels)
}

const toHistoricalTags = (record: MockCanonicalWrongNoteRecord) => {
  const identity = getQuestionContractIdentity(record.lastWrongQuestion)
  const tags = toValidatedSortedTagLabels(record.lastWrongQuestion.tags).map(
    (label) => ({
      id:
        identity?.tagIdByNormalizedLabel[normalizeQuestionTagText(label)] ??
        toStableMockUuid('question-tag', normalizeQuestionTagText(label)),
      label
    })
  )
  if (new Set(tags.map(({ id }) => id)).size !== tags.length) {
    throw new MockWrongNoteReadIntegrityError(
      'Historical tag labels cannot map to the same canonical tag ID.'
    )
  }

  return tags
}

export const toContractWrongNoteSummary = (
  record: MockCanonicalWrongNoteRecord
): WrongNoteSummary => ({
  questionId: getCanonicalQuestionId(record.lastWrongQuestion),
  level: record.lastWrongQuestion.level,
  subject: record.lastWrongQuestion.subject,
  questionType: record.lastWrongQuestion.questionType,
  questionPreview: createMockWrongNoteQuestionPreview(
    record.lastWrongQuestion.questionText
  ),
  wrongCount: record.wrongCount,
  correctStreak: record.correctStreak,
  status: record.status,
  lastWrongAt: record.lastWrongAt,
  lastReviewedAt: record.lastReviewedAt,
  nextReviewAt: record.nextReviewAt,
  tags: toValidatedSortedTagLabels(record.lastWrongQuestion.tags),
  hasMemo: false,
  reviewAvailability: record.isCurrentPublished ? 'AVAILABLE' : 'ARCHIVED'
})

const toContractReviewedQuestion = (record: MockCanonicalWrongNoteRecord) => {
  const identity = getQuestionContractIdentity(record.lastWrongQuestion)
  const correctOptions = record.lastWrongQuestion.options.filter(
    ({ isCorrect }) => isCorrect
  )
  const correctOption = correctOptions[0]
  if (!correctOption || correctOptions.length !== 1) {
    throw new MockWrongNoteReadIntegrityError(
      'Historical last-wrong snapshot must have exactly one correct option.'
    )
  }

  const versionFingerprint = getQuestionVersionFingerprint(
    record.lastWrongQuestion
  )
  const derivedVersionId =
    identity?.questionVersionId ??
    toStableMockUuid(
      'question-version',
      `${record.sourceQuestionId}:${versionFingerprint}`
    )
  if (derivedVersionId !== record.lastWrongQuestionVersionId) {
    throw new MockWrongNoteReadIntegrityError(
      'Historical snapshot fingerprint does not match its pinned version ID.'
    )
  }
  const toContractOptionId = (optionId: string): string =>
    identity?.optionIdBySourceId[optionId] ??
    toStableMockUuid('question-option', `${optionId}:${versionFingerprint}`)

  return {
    id: getCanonicalQuestionId(record.lastWrongQuestion),
    questionVersionId: record.lastWrongQuestionVersionId,
    level: record.lastWrongQuestion.level,
    subject: record.lastWrongQuestion.subject,
    questionType: record.lastWrongQuestion.questionType,
    passage: record.lastWrongQuestion.passage,
    questionText: record.lastWrongQuestion.questionText,
    options: record.lastWrongQuestion.options.map(({ id, label, text }) => ({
      id: toContractOptionId(id),
      label,
      text
    })),
    difficulty: record.lastWrongQuestion.difficulty,
    tags: toHistoricalTags(record),
    correctOptionId: toContractOptionId(correctOption.id),
    explanationKo: record.lastWrongQuestion.explanationKo,
    explanationJa: record.lastWrongQuestion.explanationJa
  }
}

export const toContractWrongNoteDetail = (
  record: MockCanonicalWrongNoteRecord
): GetWrongNoteResponse => ({
  wrongNote: toContractWrongNoteSummary(record),
  question: toContractReviewedQuestion(record),
  memo: null,
  lastWrongQuestionVersionId: record.lastWrongQuestionVersionId,
  currentReviewQuestionVersionId: record.currentReviewQuestionVersionId
})
