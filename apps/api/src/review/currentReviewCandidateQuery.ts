import type {
  JlptLevel,
  QuestionSubject,
  QuestionType
} from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'

export interface CurrentReviewCandidateFilter {
  readonly level?: JlptLevel
  readonly questionType?: QuestionType
  readonly subject?: QuestionSubject
  readonly tag?: string
  readonly userId: string
}

export type ReviewQueueView = 'DUE' | 'REPEATED' | 'SOLVED' | 'UNREVIEWED'
export type ReviewQueueSort = 'MOST_WRONG' | 'NEXT_REVIEW' | 'RECENT'

const optionalPredicate = (
  enabled: boolean,
  predicate: Prisma.Sql
): Prisma.Sql => (enabled ? predicate : Prisma.empty)

export const createCurrentReviewCandidatePredicate = (
  filter: CurrentReviewCandidateFilter
): Prisma.Sql => Prisma.sql`
  note."userId" = ${filter.userId}::uuid
  AND question."lifecycleStatus" = 'ACTIVE'
  AND version."status" = 'PUBLISHED'
  ${optionalPredicate(
    filter.level !== undefined,
    Prisma.sql`AND version."level" = ${filter.level}::"JlptLevel"`
  )}
  ${optionalPredicate(
    filter.subject !== undefined,
    Prisma.sql`AND version."subject" = ${filter.subject}::"QuestionSubject"`
  )}
  ${optionalPredicate(
    filter.questionType !== undefined,
    Prisma.sql`AND version."questionType" = ${filter.questionType}::"QuestionType"`
  )}
  ${optionalPredicate(
    filter.tag !== undefined,
    Prisma.sql`
      AND EXISTS (
        SELECT 1
        FROM "QuestionVersionTag" AS filter_tag
        WHERE filter_tag."questionVersionId" = version."id"
          AND (filter_tag."labelSnapshot" COLLATE "C") =
            (${filter.tag} COLLATE "C")
      )
    `
  )}
`

export const createReviewQueueViewCondition = (
  view: ReviewQueueView,
  observedAt: Date
): Prisma.Sql => {
  switch (view) {
    case 'DUE':
      return Prisma.sql`schedule."nextReviewAt" <= ${observedAt}`
    case 'UNREVIEWED':
      return Prisma.sql`note."lastReviewedAt" IS NULL`
    case 'REPEATED':
      return Prisma.sql`note."wrongCount" >= 2`
    case 'SOLVED':
      return Prisma.sql`note."status" = 'SOLVED'`
  }
}

export const reviewQueueStatusOrder = Prisma.sql`
  CASE note."status"
    WHEN 'AGAIN'::"WrongNoteStatus" THEN 0
    WHEN 'NEW'::"WrongNoteStatus" THEN 1
    WHEN 'REVIEWING'::"WrongNoteStatus" THEN 2
    WHEN 'SOLVED'::"WrongNoteStatus" THEN 3
  END
`

export const createReviewQueueOrder = (sort: ReviewQueueSort): Prisma.Sql => {
  switch (sort) {
    case 'NEXT_REVIEW':
      return Prisma.sql`
        schedule."nextReviewAt" ASC,
        ${reviewQueueStatusOrder} ASC,
        note."questionId" ASC
      `
    case 'MOST_WRONG':
      return Prisma.sql`
        note."wrongCount" DESC,
        note."lastWrongAt" DESC,
        note."questionId" ASC
      `
    case 'RECENT':
      return Prisma.sql`
        note."lastWrongAt" DESC,
        note."questionId" ASC
      `
  }
}
