import type { GetWrongNoteResponse } from '@nihongo/contracts/wrong-note/get-wrong-note'
import {
  compareWrongNoteTagLabels,
  trimWrongNoteTagLabel,
  type ListWrongNotesResponse,
  type WrongNoteSummary
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { toPublicPracticeQuestion } from '../question/questionMapper.js'
import type {
  HistoricalQuestionSummaryRecord,
  HistoricalReviewedQuestionRecord,
  WrongNoteDetailRecord,
  WrongNoteReadRecord
} from './wrongNoteRepository.js'

const QUESTION_PREVIEW_MAX_LENGTH = 160

export class WrongNoteMapperIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WrongNoteMapperIntegrityError'
  }
}

export const createWrongNoteQuestionPreview = (
  questionText: string
): string => {
  const characters = [...questionText]

  if (characters.length <= QUESTION_PREVIEW_MAX_LENGTH) {
    return questionText
  }

  return `${characters.slice(0, QUESTION_PREVIEW_MAX_LENGTH - 3).join('')}...`
}

const toDistinctSortedTagLabels = (
  tags: readonly { readonly label: string }[]
): string[] => {
  const exactLabels = new Set<string>()
  const labels: string[] = []

  for (const { label } of tags.toSorted((left, right) =>
    compareWrongNoteTagLabels(left.label, right.label)
  )) {
    const trimmed = trimWrongNoteTagLabel(label)
    if (!exactLabels.has(trimmed)) {
      exactLabels.add(trimmed)
      labels.push(trimmed)
    }
  }

  return labels
}

const assertReadableRecord = (record: WrongNoteReadRecord): void => {
  if (record.nextReviewAt === null) {
    throw new WrongNoteMapperIntegrityError(
      'WrongNote is missing its required ReviewSchedule.'
    )
  }
  if (
    record.question.id !== record.questionId ||
    record.question.questionVersionId.length === 0
  ) {
    throw new WrongNoteMapperIntegrityError(
      'WrongNote historical question identity is inconsistent.'
    )
  }
}

const toAvailability = (
  record: WrongNoteReadRecord
): WrongNoteSummary['reviewAvailability'] =>
  record.questionLifecycleStatus === 'ACTIVE' &&
  record.currentPublishedVersionStatus === 'PUBLISHED'
    ? 'AVAILABLE'
    : 'ARCHIVED'

const toWrongNoteSummaryFromQuestion = (
  record: WrongNoteReadRecord,
  question: HistoricalQuestionSummaryRecord
): WrongNoteSummary => {
  assertReadableRecord(record)
  if (question.id !== record.questionId) {
    throw new WrongNoteMapperIntegrityError(
      'WrongNote summary does not use the last-wrong question identity.'
    )
  }

  return {
    questionId: record.questionId,
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    questionPreview: createWrongNoteQuestionPreview(question.questionText),
    wrongCount: record.wrongCount,
    correctStreak: record.correctStreak,
    status: record.status,
    lastWrongAt: record.lastWrongAt.toISOString(),
    lastReviewedAt: record.lastReviewedAt?.toISOString() ?? null,
    nextReviewAt: record.nextReviewAt!.toISOString(),
    tags: toDistinctSortedTagLabels(question.tags),
    hasMemo: false,
    reviewAvailability: toAvailability(record)
  }
}

export const toWrongNoteSummary = (
  record: WrongNoteReadRecord
): WrongNoteSummary => toWrongNoteSummaryFromQuestion(record, record.question)

const toReviewedQuestion = (question: HistoricalReviewedQuestionRecord) => {
  if (question.correctOptionId === null) {
    throw new WrongNoteMapperIntegrityError(
      'Historical last-wrong version has no correct option.'
    )
  }

  return {
    ...toPublicPracticeQuestion({
      id: question.id,
      questionVersionId: question.questionVersionId,
      level: question.level,
      subject: question.subject,
      questionType: question.questionType,
      passage: question.passage,
      questionText: question.questionText,
      difficulty: question.difficulty,
      options: question.options,
      tags: question.tags
    }),
    correctOptionId: question.correctOptionId,
    explanationKo: question.explanationKo,
    explanationJa: question.explanationJa
  }
}

export const toWrongNoteDetail = (
  record: WrongNoteDetailRecord
): GetWrongNoteResponse => {
  const wrongNote = toWrongNoteSummaryFromQuestion(record, record.question)
  const question = toReviewedQuestion(record.question)

  return {
    wrongNote,
    question,
    memo: null,
    lastWrongQuestionVersionId: record.question.questionVersionId,
    currentReviewQuestionVersionId: record.currentReviewQuestionVersionId
  }
}

export const toListWrongNotesResponse = (
  records: readonly WrongNoteReadRecord[],
  availableTagLabels: readonly string[],
  page: number,
  pageSize: number,
  total: number
): ListWrongNotesResponse => ({
  items: records.map(toWrongNoteSummary),
  page,
  pageSize,
  total,
  availableTags: toDistinctSortedTagLabels(
    availableTagLabels.map((label) => ({ label }))
  )
})
