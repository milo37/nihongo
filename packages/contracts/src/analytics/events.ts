import { z } from 'zod'
import { questionReportReasonSchema } from '../admin/phase7-future.js'
import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionSubjectSchema,
  studyModeSchema
} from '../common/enum.js'
import { requestIdSchema } from '../common/id.js'

export const analyticsEnvironmentSchema = z.enum([
  'LOCAL',
  'TEST',
  'DEVELOPMENT',
  'STAGING',
  'PRODUCTION'
])

export const analyticsReleaseIdSchema = z.string().regex(/^[0-9a-f]{40}$/u)

const questionCountSchema = z.number().int().min(1).max(20)
const answerOrdinalSchema = z.number().int().min(1).max(20)
const emptyPayloadSchema = z.object({}).strict()

const envelope = {
  schemaVersion: z.literal(1),
  occurredAt: isoDateTimeSchema,
  environment: analyticsEnvironmentSchema,
  releaseId: analyticsReleaseIdSchema,
  correlationId: requestIdSchema
} as const

const learningConfigurationPayloadSchema = z
  .object({
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    questionCount: questionCountSchema
  })
  .strict()

const studySummaryPayloadSchema = z
  .object({
    mode: studyModeSchema,
    questionCount: questionCountSchema
  })
  .strict()

const reviewPayloadSchema = z
  .object({
    source: z.enum(['WRONG_NOTE', 'DAILY_REVIEW']),
    questionCount: questionCountSchema
  })
  .strict()

export const analyticsEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      ...envelope,
      event: z.literal('sign_up'),
      payload: emptyPayloadSchema
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('login'),
      payload: emptyPayloadSchema
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('practice_configured'),
      payload: learningConfigurationPayloadSchema
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('study_started'),
      payload: learningConfigurationPayloadSchema
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('question_answered'),
      payload: z.object({ ordinal: answerOrdinalSchema }).strict()
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('study_submitted'),
      payload: studySummaryPayloadSchema
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('wrong_note_opened'),
      payload: z
        .object({ surface: z.enum(['LIST', 'DETAIL', 'REVIEW_CENTER']) })
        .strict()
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('review_started'),
      payload: reviewPayloadSchema
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('review_submitted'),
      payload: reviewPayloadSchema
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('bookmark_created'),
      payload: z
        .object({ surface: z.enum(['PRACTICE', 'RESULT', 'WRONG_NOTE']) })
        .strict()
    })
    .strict(),
  z
    .object({
      ...envelope,
      event: z.literal('question_reported'),
      payload: z.object({ reason: questionReportReasonSchema }).strict()
    })
    .strict()
])

export type AnalyticsEnvironment = z.output<typeof analyticsEnvironmentSchema>
export type AnalyticsEvent = z.output<typeof analyticsEventSchema>
export type AnalyticsEventInput = AnalyticsEvent extends infer Event
  ? Event extends AnalyticsEvent
    ? Omit<
        Event,
        | 'schemaVersion'
        | 'occurredAt'
        | 'environment'
        | 'releaseId'
        | 'correlationId'
      >
    : never
  : never
