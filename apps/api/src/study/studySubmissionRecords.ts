import { randomUUID } from 'node:crypto'
import { applyWrongNoteReview } from '@nihongo/domain/review/apply-wrong-note-review'

import { gradePinnedStudySubmission } from '@nihongo/domain/grading/grade-study-submission'
import {
  Prisma,
  type PrismaClient,
  type StudySessionStatus
} from '../generated/prisma/client.js'
import { type ExistingStudyOwner } from './studySessionRepository.js'

import {
  type ReviewedQuestionRecord,
  type StudyResultRecord
} from './studySubmissionMapper.js'

import { ownerWhere } from './studyRepositorySupport.js'
import {
  StudySessionAlreadySubmittedError,
  StudySessionNotEditableError,
  StudySubmissionRepositoryIntegrityError,
  type LockedWrongNoteRow,
  type AtomicQuestion,
  type AtomicSession
} from './studySubmissionModel.js'
import { toWrongNoteState } from './studySubmissionLocks.js'

export const loadStudyResultRecord = async (
  client: Prisma.TransactionClient | PrismaClient,
  sessionId: string,
  owner: ExistingStudyOwner
): Promise<StudyResultRecord | null> => {
  const session = await client.studySession.findFirst({
    where: { id: sessionId, ...ownerWhere(owner) },
    select: {
      id: true,
      level: true,
      subject: true,
      mode: true,
      submittedAt: true
    }
  })

  if (!session) {
    return null
  }
  const result = await client.studyResult.findUnique({
    where: { studySessionId: sessionId },
    select: {
      totalCount: true,
      correctCount: true,
      incorrectCount: true,
      correctRateBasisPoints: true,
      durationSec: true
    }
  })
  if (!result || !session.submittedAt) {
    return null
  }

  const sessionQuestions = await client.studySessionQuestion.findMany({
    where: { studySessionId: sessionId },
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      ordinal: true,
      questionId: true,
      questionVersionId: true
    }
  })
  const questionVersionIds = sessionQuestions.map(
    ({ questionVersionId }) => questionVersionId
  )
  const questionVersions =
    questionVersionIds.length === 0
      ? []
      : await client.questionVersion.findMany({
          where: { id: { in: questionVersionIds } },
          select: {
            id: true,
            level: true,
            subject: true,
            questionType: true,
            passage: true,
            questionText: true,
            difficulty: true,
            correctOptionId: true,
            explanationKo: true,
            explanationJa: true
          }
        })
  const options =
    questionVersionIds.length === 0
      ? []
      : await client.questionOption.findMany({
          where: { questionVersionId: { in: questionVersionIds } },
          orderBy: [{ questionVersionId: 'asc' }, { ordinal: 'asc' }],
          select: {
            id: true,
            label: true,
            text: true,
            questionVersionId: true
          }
        })
  const tags =
    questionVersionIds.length === 0
      ? []
      : await client.questionVersionTag.findMany({
          where: { questionVersionId: { in: questionVersionIds } },
          orderBy: [
            { questionVersionId: 'asc' },
            { tag: { label: 'asc' } },
            { tagId: 'asc' }
          ],
          select: {
            questionVersionId: true,
            tagId: true,
            tag: { select: { label: true } }
          }
        })
  const sessionQuestionIds = sessionQuestions.map(({ id }) => id)
  const answers =
    sessionQuestionIds.length === 0
      ? []
      : await client.studyAnswer.findMany({
          where: { studySessionQuestionId: { in: sessionQuestionIds } },
          select: {
            id: true,
            studySessionQuestionId: true,
            selectedOptionId: true,
            isCorrect: true
          }
        })
  const answerIds = answers.map(({ id }) => id)
  const reviewEvents =
    answerIds.length === 0
      ? []
      : await client.reviewEvent.findMany({
          where: { studyAnswerId: { in: answerIds } },
          select: { studyAnswerId: true, nextStatus: true }
        })
  const versionsById = new Map(
    questionVersions.map((version) => [version.id, version])
  )
  const optionsByVersionId = new Map<
    string,
    Array<{ id: string; label: string; text: string }>
  >()
  for (const option of options) {
    const versionOptions = optionsByVersionId.get(option.questionVersionId)
    const value = { id: option.id, label: option.label, text: option.text }
    if (versionOptions) {
      versionOptions.push(value)
    } else {
      optionsByVersionId.set(option.questionVersionId, [value])
    }
  }
  const tagsByVersionId = new Map<
    string,
    Array<{ id: string; label: string }>
  >()
  for (const tag of tags) {
    const versionTags = tagsByVersionId.get(tag.questionVersionId)
    const value = { id: tag.tagId, label: tag.tag.label }
    if (versionTags) {
      versionTags.push(value)
    } else {
      tagsByVersionId.set(tag.questionVersionId, [value])
    }
  }
  const answersBySessionQuestionId = new Map(
    answers.map((answer) => [answer.studySessionQuestionId, answer])
  )
  const reviewEventsByAnswerId = new Map(
    reviewEvents.flatMap((event) =>
      event.studyAnswerId ? [[event.studyAnswerId, event] as const] : []
    )
  )

  const questions = sessionQuestions.map((item) => {
    const answer = answersBySessionQuestionId.get(item.id)
    const questionVersion = versionsById.get(item.questionVersionId)
    if (!answer || !questionVersion?.correctOptionId) {
      throw new StudySubmissionRepositoryIntegrityError(
        'Submitted StudySession has an incomplete result projection.'
      )
    }
    const question: ReviewedQuestionRecord = {
      id: item.questionId,
      questionVersionId: questionVersion.id,
      level: questionVersion.level,
      subject: questionVersion.subject,
      questionType: questionVersion.questionType,
      passage: questionVersion.passage,
      questionText: questionVersion.questionText,
      difficulty: questionVersion.difficulty,
      options: optionsByVersionId.get(questionVersion.id) ?? [],
      tags: tagsByVersionId.get(questionVersion.id) ?? [],
      correctOptionId: questionVersion.correctOptionId,
      explanationKo: questionVersion.explanationKo,
      explanationJa: questionVersion.explanationJa
    }

    return {
      sessionQuestionId: item.id,
      ordinal: item.ordinal,
      question,
      answer: {
        selectedOptionId: answer.selectedOptionId,
        isCorrect: answer.isCorrect,
        reviewEvent: reviewEventsByAnswerId.get(answer.id) ?? null
      }
    }
  })

  return {
    id: session.id,
    level: session.level,
    subject: session.subject,
    mode: session.mode,
    submittedAt: session.submittedAt,
    ...result,
    questions
  }
}

export const createReviewFacts = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly answerIdBySessionQuestionId: ReadonlyMap<string, string>
    readonly effectiveSubmittedAt: Date
    readonly gradedAnswers: ReturnType<
      typeof gradePinnedStudySubmission
    >['answers']
    readonly mode: AtomicSession['mode']
    readonly questions: readonly AtomicQuestion[]
    readonly sessionId: string
    readonly userId: string
    readonly wrongNotes: readonly LockedWrongNoteRow[]
  }
): Promise<void> => {
  const questionBySessionQuestionId = new Map(
    input.questions.map((question) => [
      question.studySessionQuestionId,
      question
    ])
  )
  const wrongNoteByQuestionId = new Map(
    input.wrongNotes.map((wrongNote) => [wrongNote.questionId, wrongNote])
  )
  const answers = input.gradedAnswers
    .map((answer) => {
      const question = questionBySessionQuestionId.get(
        answer.studySessionQuestionId
      )
      if (!question) {
        throw new StudySubmissionRepositoryIntegrityError(
          'Graded answer no longer matches a pinned question.'
        )
      }
      return { answer, question }
    })
    .toSorted((left, right) =>
      left.question.questionId.localeCompare(right.question.questionId)
    )

  for (const { answer, question } of answers) {
    const previousRow = wrongNoteByQuestionId.get(question.questionId) ?? null
    const decision = applyWrongNoteReview({
      previous: previousRow ? toWrongNoteState(previousRow) : null,
      isCorrect: answer.isCorrect,
      occurredAt: input.effectiveSubmittedAt
    })
    if (!decision) {
      continue
    }

    const wrongNoteId = previousRow?.id ?? randomUUID()
    if (previousRow) {
      await transaction.wrongNote.update({
        where: { id: wrongNoteId },
        data: {
          lastWrongQuestionVersionId: answer.isCorrect
            ? previousRow.lastWrongQuestionVersionId
            : answer.questionVersionId,
          wrongCount: decision.wrongNote.wrongCount,
          correctStreak: decision.wrongNote.correctStreak,
          status: decision.wrongNote.status,
          lastWrongAt: decision.wrongNote.lastWrongAt,
          lastReviewedAt: decision.wrongNote.lastReviewedAt,
          updatedAt: input.effectiveSubmittedAt,
          schedule: {
            update: {
              nextReviewAt: decision.schedule.nextReviewAt,
              intervalDays: decision.schedule.intervalDays,
              algorithmVersion: decision.schedule.algorithmVersion,
              updatedAt: input.effectiveSubmittedAt
            }
          }
        }
      })
    } else {
      await transaction.wrongNote.create({
        data: {
          id: wrongNoteId,
          userId: input.userId,
          questionId: question.questionId,
          lastWrongQuestionVersionId: answer.questionVersionId,
          currentReviewQuestionVersionId: null,
          wrongCount: decision.wrongNote.wrongCount,
          correctStreak: decision.wrongNote.correctStreak,
          status: decision.wrongNote.status,
          lastWrongAt: decision.wrongNote.lastWrongAt,
          lastReviewedAt: decision.wrongNote.lastReviewedAt,
          createdAt: input.effectiveSubmittedAt,
          updatedAt: input.effectiveSubmittedAt,
          schedule: {
            create: {
              id: randomUUID(),
              nextReviewAt: decision.schedule.nextReviewAt,
              intervalDays: decision.schedule.intervalDays,
              algorithmVersion: decision.schedule.algorithmVersion,
              updatedAt: input.effectiveSubmittedAt
            }
          }
        }
      })
    }

    const studyAnswerId = input.answerIdBySessionQuestionId.get(
      answer.studySessionQuestionId
    )
    if (!studyAnswerId) {
      throw new StudySubmissionRepositoryIntegrityError(
        'ReviewEvent evidence StudyAnswer is missing.'
      )
    }
    await transaction.reviewEvent.create({
      data: {
        id: randomUUID(),
        wrongNoteId,
        userId: input.userId,
        questionId: question.questionId,
        questionVersionId: answer.questionVersionId,
        source:
          input.mode === 'WRONG_NOTE' || input.mode === 'DAILY_REVIEW'
            ? 'WRONG_NOTE_REVIEW'
            : 'STUDY_SUBMIT',
        studySessionId: input.sessionId,
        studyAnswerId,
        selectedOptionId: answer.selectedOptionId,
        isCorrect: answer.isCorrect,
        previousStatus: decision.event.previousStatus,
        nextStatus: decision.event.nextStatus,
        previousCorrectStreak: decision.event.previousCorrectStreak,
        nextCorrectStreak: decision.event.nextCorrectStreak,
        previousWrongCount: decision.event.previousWrongCount,
        wrongCountAfter: decision.event.wrongCountAfter,
        algorithmVersion: decision.event.algorithmVersion,
        occurredAt: decision.event.occurredAt
      }
    })
  }
}

export const assertEditable = (
  status: StudySessionStatus,
  expiresAt: Date,
  observedAt: Date
): void => {
  if (status === 'SUBMITTED') {
    throw new StudySessionAlreadySubmittedError()
  }
  if (status !== 'IN_PROGRESS' || expiresAt <= observedAt) {
    throw new StudySessionNotEditableError()
  }
}

export const expireLockedSubmissionSession = async (
  transaction: Prisma.TransactionClient,
  sessionId: string,
  observedAt: Date,
  preserveGuestDraft: boolean
): Promise<void> => {
  await transaction.studySession.update({
    where: { id: sessionId },
    data: { status: 'EXPIRED', updatedAt: observedAt }
  })
  if (!preserveGuestDraft) {
    await transaction.studyDraft.deleteMany({
      where: { studySessionId: sessionId }
    })
  }
}
