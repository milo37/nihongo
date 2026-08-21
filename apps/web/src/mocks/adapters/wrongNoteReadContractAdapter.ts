import type { GetWrongNoteResponse } from '@nihongo/contracts/wrong-note/get-wrong-note'
import { normalizeQuestionTagText } from '@nihongo/contracts/question/get-question'
import {
  compareWrongNoteTagLabels,
  trimWrongNoteTagLabel,
  type ListWrongNotesResponse,
  type ParsedListWrongNotesQuery,
  type WrongNoteSummary
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import {
  getContractQuestionId,
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
  const tags = toValidatedSortedTagLabels(record.lastWrongQuestion.tags).map(
    (label) => ({
      id: toStableMockUuid('question-tag', normalizeQuestionTagText(label)),
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
  questionId: getContractQuestionId(record.sourceQuestionId),
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
  const derivedVersionId = toStableMockUuid(
    'question-version',
    `${record.sourceQuestionId}:${versionFingerprint}`
  )
  if (derivedVersionId !== record.lastWrongQuestionVersionId) {
    throw new MockWrongNoteReadIntegrityError(
      'Historical snapshot fingerprint does not match its pinned version ID.'
    )
  }
  const toContractOptionId = (optionId: string): string =>
    toStableMockUuid('question-option', `${optionId}:${versionFingerprint}`)

  return {
    id: getContractQuestionId(record.sourceQuestionId),
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

const compareRecords = (
  left: MockCanonicalWrongNoteRecord,
  right: MockCanonicalWrongNoteRecord,
  sort: ParsedListWrongNotesQuery['sort']
): number => {
  if (sort === 'MOST_WRONG') {
    return (
      right.wrongCount - left.wrongCount ||
      right.lastWrongAt.localeCompare(left.lastWrongAt) ||
      left.wrongNoteId.localeCompare(right.wrongNoteId)
    )
  }
  if (sort === 'OLDEST') {
    return (
      left.lastWrongAt.localeCompare(right.lastWrongAt) ||
      left.wrongNoteId.localeCompare(right.wrongNoteId)
    )
  }

  return (
    right.lastWrongAt.localeCompare(left.lastWrongAt) ||
    left.wrongNoteId.localeCompare(right.wrongNoteId)
  )
}

export const toContractWrongNoteList = (
  records: readonly MockCanonicalWrongNoteRecord[],
  query: ParsedListWrongNotesQuery
): ListWrongNotesResponse => {
  const tagsByRecord = new Map(
    records.map((record) => [
      record.wrongNoteId,
      toValidatedSortedTagLabels(record.lastWrongQuestion.tags)
    ])
  )
  const availableTags = [
    ...new Set([...tagsByRecord.values()].flat())
  ].toSorted(compareWrongNoteTagLabels)
  const matches = records.filter((record) => {
    const tags = tagsByRecord.get(record.wrongNoteId)
    if (!tags) {
      throw new MockWrongNoteReadIntegrityError(
        'Historical tag projection is missing for a canonical WrongNote.'
      )
    }

    return (
      (!query.level || record.lastWrongQuestion.level === query.level) &&
      (!query.subject || record.lastWrongQuestion.subject === query.subject) &&
      (!query.status || record.status === query.status) &&
      (!query.tag || tags.includes(query.tag))
    )
  })
  const sorted = matches.toSorted((left, right) =>
    compareRecords(left, right, query.sort)
  )
  const offset = (BigInt(query.page) - 1n) * BigInt(query.pageSize)
  const items =
    offset >= BigInt(sorted.length)
      ? []
      : sorted
          .slice(Number(offset), Number(offset) + query.pageSize)
          .map(toContractWrongNoteSummary)

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: sorted.length,
    availableTags
  }
}
