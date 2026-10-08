import type { SubmittedStudyAnswer } from '../grading/grade-study-submission.js'

export const STUDY_SUBMISSION_CANONICAL_PREFIX = 'submit-v1:' as const
export const STUDY_SUBMISSION_V2_CANONICAL_PREFIX = 'submit-v2:' as const

const MAX_ELAPSED_SEC = 86_400
const MAX_DURATION_SEC = 604_800

export type StudySubmissionCanonicalizationErrorCode =
  | 'INVALID_SESSION_ID'
  | 'INVALID_SESSION_QUESTION_ORDER'
  | 'DUPLICATE_SESSION_QUESTION'
  | 'DUPLICATE_ANSWER'
  | 'ANSWER_NOT_IN_SESSION'
  | 'INVALID_DURATION'

export class StudySubmissionCanonicalizationError extends Error {
  readonly code: StudySubmissionCanonicalizationErrorCode

  constructor(code: StudySubmissionCanonicalizationErrorCode, message: string) {
    super(message)
    this.name = 'StudySubmissionCanonicalizationError'
    this.code = code
  }
}

export interface OrderedSessionQuestionForSubmission {
  readonly studySessionQuestionId: string
  readonly ordinal: number
}

export interface CanonicalizeStudySubmissionInput {
  readonly sessionId: string
  readonly orderedSessionQuestions: readonly OrderedSessionQuestionForSubmission[]
  readonly answers: readonly SubmittedStudyAnswer[]
  readonly durationSec: number
}

export interface CanonicalizeStudySubmissionV2Input
  extends CanonicalizeStudySubmissionInput {
  readonly expectedDraftRevision: number
}

const isValidDuration = (value: number, maximum: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= maximum

const normalizeSessionQuestions = (
  questions: readonly OrderedSessionQuestionForSubmission[]
): OrderedSessionQuestionForSubmission[] => {
  if (questions.length === 0) {
    throw new StudySubmissionCanonicalizationError(
      'INVALID_SESSION_QUESTION_ORDER',
      '세션 문제가 하나 이상 필요합니다.'
    )
  }

  const ids = new Set<string>()
  const ordinals = new Set<number>()

  for (const question of questions) {
    if (ids.has(question.studySessionQuestionId)) {
      throw new StudySubmissionCanonicalizationError(
        'DUPLICATE_SESSION_QUESTION',
        `세션 문제가 중복되었습니다: ${question.studySessionQuestionId}`
      )
    }

    if (ordinals.has(question.ordinal)) {
      throw new StudySubmissionCanonicalizationError(
        'INVALID_SESSION_QUESTION_ORDER',
        `세션 문제 ordinal이 중복되었습니다: ${question.ordinal}`
      )
    }

    ids.add(question.studySessionQuestionId)
    ordinals.add(question.ordinal)
  }

  const ordered = [...questions].sort(
    (left, right) => left.ordinal - right.ordinal
  )

  ordered.forEach((question, index) => {
    if (question.ordinal !== index + 1) {
      throw new StudySubmissionCanonicalizationError(
        'INVALID_SESSION_QUESTION_ORDER',
        '세션 문제 ordinal은 1부터 연속되어야 합니다.'
      )
    }
  })

  return ordered
}

const createAnswerIndex = (
  answers: readonly SubmittedStudyAnswer[],
  sessionQuestionIds: ReadonlySet<string>
): Map<string, SubmittedStudyAnswer> => {
  const answerBySessionQuestionId = new Map<string, SubmittedStudyAnswer>()

  for (const answer of answers) {
    if (answerBySessionQuestionId.has(answer.studySessionQuestionId)) {
      throw new StudySubmissionCanonicalizationError(
        'DUPLICATE_ANSWER',
        `답안이 중복되었습니다: ${answer.studySessionQuestionId}`
      )
    }

    if (!sessionQuestionIds.has(answer.studySessionQuestionId)) {
      throw new StudySubmissionCanonicalizationError(
        'ANSWER_NOT_IN_SESSION',
        `세션에 속하지 않은 답안입니다: ${answer.studySessionQuestionId}`
      )
    }

    if (!isValidDuration(answer.elapsedSec, MAX_ELAPSED_SEC)) {
      throw new StudySubmissionCanonicalizationError(
        'INVALID_DURATION',
        `elapsedSec 범위를 벗어났습니다: ${answer.studySessionQuestionId}`
      )
    }

    answerBySessionQuestionId.set(answer.studySessionQuestionId, answer)
  }

  if (answerBySessionQuestionId.size !== sessionQuestionIds.size) {
    throw new StudySubmissionCanonicalizationError(
      'ANSWER_NOT_IN_SESSION',
      '모든 세션 문제에 답안이 하나씩 필요합니다.'
    )
  }

  return answerBySessionQuestionId
}

export const canonicalizeStudySubmission = ({
  sessionId,
  orderedSessionQuestions,
  answers,
  durationSec
}: CanonicalizeStudySubmissionInput): string => {
  if (sessionId.trim().length === 0) {
    throw new StudySubmissionCanonicalizationError(
      'INVALID_SESSION_ID',
      'sessionId가 필요합니다.'
    )
  }

  if (!isValidDuration(durationSec, MAX_DURATION_SEC)) {
    throw new StudySubmissionCanonicalizationError(
      'INVALID_DURATION',
      'durationSec 범위를 벗어났습니다.'
    )
  }

  const orderedQuestions = normalizeSessionQuestions(orderedSessionQuestions)
  const sessionQuestionIds = new Set(
    orderedQuestions.map((question) => question.studySessionQuestionId)
  )
  const answerBySessionQuestionId = createAnswerIndex(
    answers,
    sessionQuestionIds
  )

  const normalizedAnswers = orderedQuestions.map((question) => {
    const answer = answerBySessionQuestionId.get(
      question.studySessionQuestionId
    )

    if (!answer) {
      throw new StudySubmissionCanonicalizationError(
        'ANSWER_NOT_IN_SESSION',
        `세션 문제의 답안이 없습니다: ${question.studySessionQuestionId}`
      )
    }

    return {
      studySessionQuestionId: question.studySessionQuestionId,
      selectedOptionId: answer.selectedOptionId,
      elapsedSec: answer.elapsedSec
    }
  })

  return `${STUDY_SUBMISSION_CANONICAL_PREFIX}${JSON.stringify({
    sessionId,
    answers: normalizedAnswers,
    durationSec
  })}`
}

export const canonicalizeStudySubmissionV2 = ({
  sessionId,
  orderedSessionQuestions,
  answers,
  durationSec,
  expectedDraftRevision
}: CanonicalizeStudySubmissionV2Input): string => {
  if (
    !Number.isSafeInteger(expectedDraftRevision) ||
    expectedDraftRevision < 0
  ) {
    throw new StudySubmissionCanonicalizationError(
      'INVALID_DURATION',
      'expectedDraftRevision 범위를 벗어났습니다.'
    )
  }

  const v1Canonical = canonicalizeStudySubmission({
    sessionId,
    orderedSessionQuestions,
    answers,
    durationSec
  })
  const material = JSON.parse(
    v1Canonical.slice(STUDY_SUBMISSION_CANONICAL_PREFIX.length)
  ) as {
    answers: readonly SubmittedStudyAnswer[]
    durationSec: number
    sessionId: string
  }

  return `${STUDY_SUBMISSION_V2_CANONICAL_PREFIX}${JSON.stringify({
    sessionId: material.sessionId,
    answers: material.answers,
    durationSec: material.durationSec,
    expectedDraftRevision
  })}`
}
