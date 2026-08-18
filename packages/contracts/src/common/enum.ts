import { z } from 'zod'

export const jlptLevelSchema = z.enum(['N5', 'N4', 'N3', 'N2', 'N1'])

export const questionSubjectSchema = z.enum([
  'VOCABULARY',
  'GRAMMAR',
  'READING'
])

export const questionTypeSchema = z.enum([
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
])

export const questionDifficultySchema = z.enum(['EASY', 'NORMAL', 'HARD'])

export const studyModeSchema = z.enum([
  'RANDOM',
  'WRONG_NOTE',
  'WEAKNESS',
  'BOOKMARK',
  'DAILY_REVIEW'
])

export const studySessionStatusSchema = z.enum([
  'IN_PROGRESS',
  'SUBMITTED',
  'EXPIRED',
  'CANCELLED'
])

export const practiceContractVersionSchema = z.union([
  z.literal(1),
  z.literal(2)
])

export const studyResumeAvailabilitySchema = z.enum([
  'SERVER',
  'LEGACY_LOCAL_ONLY'
])

export const studySessionFallbackReasonSchema = z.enum([
  'INSUFFICIENT_MODE_CANDIDATES'
])

export const wrongNoteStatusSchema = z.enum([
  'NEW',
  'REVIEWING',
  'AGAIN',
  'SOLVED'
])

export const wrongNoteSortSchema = z.enum(['RECENT', 'MOST_WRONG', 'OLDEST'])

export const reviewAvailabilitySchema = z.enum(['AVAILABLE', 'ARCHIVED'])

export const bookmarkAvailabilitySchema = z.enum(['AVAILABLE', 'ARCHIVED'])

export const persistedUserRoleSchema = z.enum(['USER', 'ADMIN'])

export type JlptLevel = z.output<typeof jlptLevelSchema>
export type QuestionSubject = z.output<typeof questionSubjectSchema>
export type QuestionType = z.output<typeof questionTypeSchema>
export type QuestionDifficulty = z.output<typeof questionDifficultySchema>
export type StudyMode = z.output<typeof studyModeSchema>
export type StudySessionStatus = z.output<typeof studySessionStatusSchema>
export type PracticeContractVersion = z.output<
  typeof practiceContractVersionSchema
>
export type StudyResumeAvailability = z.output<
  typeof studyResumeAvailabilitySchema
>
export type StudySessionFallbackReason = z.output<
  typeof studySessionFallbackReasonSchema
>
export type WrongNoteStatus = z.output<typeof wrongNoteStatusSchema>
export type WrongNoteSort = z.output<typeof wrongNoteSortSchema>
export type ReviewAvailability = z.output<typeof reviewAvailabilitySchema>
export type BookmarkAvailability = z.output<typeof bookmarkAvailabilitySchema>
export type PersistedUserRole = z.output<typeof persistedUserRoleSchema>
