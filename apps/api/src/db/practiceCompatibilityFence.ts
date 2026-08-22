import type { PrismaClient } from '../generated/prisma/client.js'

export interface PracticeCompatibilityFacts {
  bookmarkCount: number
  v2StudySessionCount: number
  studyDraftCount: number
  studyDraftAnswerCount: number
  currentReviewWrongNoteCount: number
  retryRelationCount: number
  targetedReviewIdempotencyRecordCount: number
  userMemoCount: number
  v2IdempotencyRecordCount: number
}

export class PracticeCompatibilityFenceError extends Error {
  constructor() {
    super('The database is not eligible for the v1-compatible runtime.')
    this.name = 'PracticeCompatibilityFenceError'
  }
}

export const assertPracticeCompatibilityFacts = (
  facts: PracticeCompatibilityFacts
): void => {
  if (
    facts.bookmarkCount !== 0 ||
    facts.v2StudySessionCount !== 0 ||
    facts.studyDraftCount !== 0 ||
    facts.studyDraftAnswerCount !== 0 ||
    facts.currentReviewWrongNoteCount !== 0 ||
    facts.retryRelationCount !== 0 ||
    facts.targetedReviewIdempotencyRecordCount !== 0 ||
    facts.userMemoCount !== 0 ||
    facts.v2IdempotencyRecordCount !== 0
  ) {
    throw new PracticeCompatibilityFenceError()
  }
}

export const checkPracticeCompatibilityFence = async (
  client: PrismaClient
): Promise<void> => {
  const [facts] = await client.$queryRaw<PracticeCompatibilityFacts[]>`
    SELECT
      (
        SELECT COUNT(*)::integer
        FROM "Bookmark"
      ) AS "bookmarkCount",
      (
        SELECT COUNT(*)::integer
        FROM "StudySession"
        WHERE "practiceContractVersion" = 2
      ) AS "v2StudySessionCount",
      (
        SELECT COUNT(*)::integer
        FROM "StudyDraft"
      ) AS "studyDraftCount",
      (
        SELECT COUNT(*)::integer
        FROM "StudyDraftAnswer"
      ) AS "studyDraftAnswerCount",
      (
        SELECT COUNT(*)::integer
        FROM "WrongNote"
        WHERE "currentReviewQuestionVersionId" IS NOT NULL
      ) AS "currentReviewWrongNoteCount",
      (
        SELECT COUNT(*)::integer
        FROM "StudySession"
        WHERE "retryOfStudySessionId" IS NOT NULL
      ) AS "retryRelationCount",
      (
        SELECT COUNT(*)::integer
        FROM "IdempotencyRecord"
        WHERE "operation" =
          'STUDY_TARGETED_REVIEW_CREATE'::"IdempotencyOperation"
      ) AS "targetedReviewIdempotencyRecordCount",
      (
        SELECT COUNT(*)::integer
        FROM "UserMemo"
      ) AS "userMemoCount",
      (
        SELECT COUNT(*)::integer
        FROM "IdempotencyRecord"
        WHERE
          "contractVersion" = 2
          OR "operation" <> 'STUDY_SUBMIT'::"IdempotencyOperation"
      ) AS "v2IdempotencyRecordCount"`

  if (!facts) {
    throw new PracticeCompatibilityFenceError()
  }

  assertPracticeCompatibilityFacts(facts)
}
