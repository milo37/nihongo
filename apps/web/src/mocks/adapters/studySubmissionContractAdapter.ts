import type {
  ParsedSubmitStudySessionBody,
  ParsedSubmitStudySessionV2Body
} from '@nihongo/contracts/study/submit-study-session'
import {
  studyResultSchema,
  type StudyResult,
  type StudyResultItem
} from '@nihongo/contracts/study/study-result'
import {
  getQuestionVersionFingerprint,
  toContractPracticeQuestion,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import type {
  MockCanonicalSubmissionOperations,
  MockStudySessionSnapshotRecord
} from '@mocks/repository/mockDatabase'
import { toPracticeQuestion } from '@util/question'

const STUDY_SUBMISSION_CANONICAL_PREFIX = 'submit-v1:'
const STUDY_SUBMISSION_V2_CANONICAL_PREFIX = 'submit-v2:'

export type MockCanonicalSubmissionValidationCode =
  | 'ANSWER_NOT_IN_SESSION'
  | 'DUPLICATE_ANSWER'
  | 'INVALID_DURATION'
  | 'OPTION_NOT_IN_VERSION'

export class MockCanonicalSubmissionValidationError extends Error {
  readonly code: MockCanonicalSubmissionValidationCode

  constructor(code: MockCanonicalSubmissionValidationCode, message: string) {
    super(message)
    this.name = 'MockCanonicalSubmissionValidationError'
    this.code = code
  }
}

export class MockCanonicalSubmissionIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MockCanonicalSubmissionIntegrityError'
  }
}

export interface MockCanonicalGradedItem {
  readonly elapsedSec: number
  readonly isCorrect: boolean
  readonly questionVersionId: string
  readonly resultItem: Omit<StudyResultItem, 'wrongNoteStatus'>
  readonly sourceQuestionId: string
  readonly studySessionQuestionId: string
}

export interface MockCanonicalGrading {
  readonly correctCount: number
  readonly durationSec: number
  readonly incorrectCount: number
  readonly items: readonly MockCanonicalGradedItem[]
  readonly level: StudyResult['level']
  readonly mode: StudyResult['mode']
  readonly sessionId: string
  readonly subject: StudyResult['subject']
  readonly submittedAt: string
  readonly totalCount: number
}

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1

const getSessionQuestionId = (sessionId: string, ordinal: number): string =>
  toStableMockUuid('study-session-question', `${sessionId}:${ordinal}`)

export const canonicalizeMockStudySubmission = (
  record: MockStudySessionSnapshotRecord,
  input: ParsedSubmitStudySessionBody
): string => {
  const ordinalBySessionQuestionId = new Map(
    record.questions.map((_, index) => [
      getSessionQuestionId(record.session.id, index + 1),
      index + 1
    ])
  )
  const answers = input.answers
    .map((answer) => ({
      studySessionQuestionId: answer.studySessionQuestionId,
      selectedOptionId: answer.selectedOptionId,
      elapsedSec: answer.elapsedSec
    }))
    .toSorted((left, right) => {
      const leftOrdinal = ordinalBySessionQuestionId.get(
        left.studySessionQuestionId
      )
      const rightOrdinal = ordinalBySessionQuestionId.get(
        right.studySessionQuestionId
      )

      if (leftOrdinal !== undefined && rightOrdinal !== undefined) {
        return (
          leftOrdinal - rightOrdinal ||
          compareText(left.studySessionQuestionId, right.studySessionQuestionId)
        )
      }
      if (leftOrdinal !== undefined) {
        return -1
      }
      if (rightOrdinal !== undefined) {
        return 1
      }
      return compareText(
        left.studySessionQuestionId,
        right.studySessionQuestionId
      )
    })

  return `${STUDY_SUBMISSION_CANONICAL_PREFIX}${JSON.stringify({
    sessionId: record.session.id,
    answers,
    durationSec: input.durationSec
  })}`
}

export const canonicalizeMockStudySubmissionV2 = (
  record: MockStudySessionSnapshotRecord,
  input: ParsedSubmitStudySessionBody | ParsedSubmitStudySessionV2Body
): string => {
  if (!('expectedDraftRevision' in input)) {
    throw new MockCanonicalSubmissionIntegrityError(
      'v2 제출에는 expectedDraftRevision이 필요합니다.'
    )
  }
  const v1Material = canonicalizeMockStudySubmission(record, input)
  const parsedMaterial: unknown = JSON.parse(
    v1Material.slice(STUDY_SUBMISSION_CANONICAL_PREFIX.length)
  )

  return `${STUDY_SUBMISSION_V2_CANONICAL_PREFIX}${JSON.stringify({
    ...(typeof parsedMaterial === 'object' && parsedMaterial !== null
      ? parsedMaterial
      : {}),
    expectedDraftRevision: input.expectedDraftRevision
  })}`
}

const assertDuration = (input: ParsedSubmitStudySessionBody): void => {
  if (
    !Number.isInteger(input.durationSec) ||
    input.durationSec < 0 ||
    input.durationSec > 604_800 ||
    input.answers.some(
      ({ elapsedSec }) =>
        !Number.isInteger(elapsedSec) || elapsedSec < 0 || elapsedSec > 86_400
    )
  ) {
    throw new MockCanonicalSubmissionValidationError(
      'INVALID_DURATION',
      '답안 풀이 시간이 허용 범위를 벗어났습니다.'
    )
  }
}

const getCorrectOption = (
  question: MockStudySessionSnapshotRecord['questions'][number]
): MockStudySessionSnapshotRecord['questions'][number]['options'][number] => {
  const correctOptions = question.options.filter(({ isCorrect }) => isCorrect)
  const correctOption = correctOptions[0]

  if (!correctOption || correctOptions.length !== 1) {
    throw new MockCanonicalSubmissionIntegrityError(
      '고정된 문제 version에는 정답 보기가 정확히 하나 있어야 합니다.'
    )
  }
  return correctOption
}

export const gradeMockCanonicalStudySubmission = (
  record: MockStudySessionSnapshotRecord,
  input: ParsedSubmitStudySessionBody,
  submittedAt: string
): MockCanonicalGrading => {
  assertDuration(input)

  const answerBySessionQuestionId = new Map(
    input.answers.map((answer) => [answer.studySessionQuestionId, answer])
  )
  if (answerBySessionQuestionId.size !== input.answers.length) {
    throw new MockCanonicalSubmissionValidationError(
      'DUPLICATE_ANSWER',
      '같은 세션 문제의 답안을 중복 제출할 수 없습니다.'
    )
  }

  const knownSessionQuestionIds = new Set(
    record.questions.map((_, index) =>
      getSessionQuestionId(record.session.id, index + 1)
    )
  )
  if (
    input.answers.length !== record.questions.length ||
    input.answers.some(
      ({ studySessionQuestionId }) =>
        !knownSessionQuestionIds.has(studySessionQuestionId)
    )
  ) {
    throw new MockCanonicalSubmissionValidationError(
      'ANSWER_NOT_IN_SESSION',
      '모든 세션 문제의 답안을 정확히 한 번씩 제출해야 합니다.'
    )
  }

  const items = record.questions.map((question, index) => {
    const ordinal = index + 1
    const studySessionQuestionId = getSessionQuestionId(
      record.session.id,
      ordinal
    )
    const answer = answerBySessionQuestionId.get(studySessionQuestionId)
    if (!answer) {
      throw new MockCanonicalSubmissionValidationError(
        'ANSWER_NOT_IN_SESSION',
        '모든 세션 문제의 답안을 정확히 한 번씩 제출해야 합니다.'
      )
    }

    const versionFingerprint = getQuestionVersionFingerprint(question)
    const publicQuestion = toContractPracticeQuestion(
      toPracticeQuestion(question),
      versionFingerprint
    )
    const optionIds = new Set(publicQuestion.options.map(({ id }) => id))
    if (
      answer.selectedOptionId !== null &&
      !optionIds.has(answer.selectedOptionId)
    ) {
      throw new MockCanonicalSubmissionValidationError(
        'OPTION_NOT_IN_VERSION',
        '선택한 보기가 고정된 문제 version에 속하지 않습니다.'
      )
    }

    const correctOption = getCorrectOption(question)
    const correctOptionId = toStableMockUuid(
      'question-option',
      `${correctOption.id}:${versionFingerprint}`
    )
    const isCorrect = answer.selectedOptionId === correctOptionId

    return {
      elapsedSec: answer.elapsedSec,
      isCorrect,
      questionVersionId: publicQuestion.questionVersionId,
      resultItem: {
        sessionQuestionId: studySessionQuestionId,
        question: {
          ...publicQuestion,
          correctOptionId,
          explanationKo: question.explanationKo,
          explanationJa: question.explanationJa
        },
        selectedOptionId: answer.selectedOptionId,
        isCorrect
      },
      sourceQuestionId: question.id,
      studySessionQuestionId
    }
  })
  const correctCount = items.filter(({ isCorrect }) => isCorrect).length

  return {
    sessionId: record.session.id,
    level: record.session.level,
    subject: record.session.subject,
    mode: record.session.mode,
    totalCount: items.length,
    correctCount,
    incorrectCount: items.length - correctCount,
    durationSec: input.durationSec,
    submittedAt,
    items
  }
}

export const toMockCanonicalStudyResult = (
  grading: MockCanonicalGrading,
  wrongNoteStatusBySessionQuestionId: ReadonlyMap<
    string,
    StudyResultItem['wrongNoteStatus']
  > = new Map()
): StudyResult =>
  studyResultSchema.parse({
    sessionId: grading.sessionId,
    level: grading.level,
    subject: grading.subject,
    mode: grading.mode,
    totalCount: grading.totalCount,
    correctCount: grading.correctCount,
    incorrectCount: grading.incorrectCount,
    correctRate:
      Math.round((grading.correctCount * 10_000) / grading.totalCount) / 100,
    durationSec: grading.durationSec,
    submittedAt: grading.submittedAt,
    items: grading.items.map(({ resultItem, studySessionQuestionId }) => ({
      ...resultItem,
      wrongNoteStatus:
        wrongNoteStatusBySessionQuestionId.get(studySessionQuestionId) ?? null
    }))
  })

export const mockCanonicalSubmissionOperations = {
  canonicalize: canonicalizeMockStudySubmission,
  grade: gradeMockCanonicalStudySubmission,
  toResult: toMockCanonicalStudyResult
} satisfies MockCanonicalSubmissionOperations

export const mockCanonicalSubmissionV2Operations = {
  canonicalize: canonicalizeMockStudySubmissionV2,
  grade: gradeMockCanonicalStudySubmission,
  toResult: toMockCanonicalStudyResult
} satisfies MockCanonicalSubmissionOperations
