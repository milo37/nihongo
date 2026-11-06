import type { StudyResult } from '@nihongo/contracts/study/study-result'

import { type SubmittedStudyAnswer } from '@nihongo/domain/grading/grade-study-submission'
import { type StudySessionStatus } from '../generated/prisma/client.js'
import { type ExistingStudyOwner } from './studySessionRepository.js'

export const GUEST_RENEWAL_MS = 7 * 24 * 60 * 60 * 1_000
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000

export interface StudySubmissionRepositoryOptions {
  afterExistingMiss?: () => Promise<void>
  afterReservation?: () => Promise<void>
  beforeFinalize?: () => Promise<void>
  delay?: (milliseconds: number) => Promise<void>
  jitterMilliseconds?: () => number
}

export interface OwnedStudySubmissionPreload {
  readonly expiresAt: Date
  readonly orderedSessionQuestions: readonly {
    readonly ordinal: number
    readonly questionId: string
    readonly studySessionQuestionId: string
  }[]
  readonly sessionId: string
  readonly practiceContractVersion?: 1 | 2
  readonly status: StudySessionStatus
}

export interface SubmitStudySessionAtomicInput {
  readonly answers: readonly SubmittedStudyAnswer[]
  readonly durationSec: number
  readonly expectedDraftRevision?: number | null
  readonly idempotencyKey: string
  readonly observedAt: Date
  readonly owner: ExistingStudyOwner
  readonly practiceContractVersion?: 1 | 2
  readonly requestHash: string
  readonly sessionId: string
}

export interface SubmitStudySessionAtomicResult {
  readonly guestProofExpiresAt: Date | null
  readonly replayed: boolean
  readonly response: StudyResult
}

export type FindOwnedStudyResultOutcome =
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'NOT_READY' }
  | { readonly kind: 'READY'; readonly response: StudyResult }

export interface StudySubmissionRepository {
  findOwnedResult: (
    sessionId: string,
    owner: ExistingStudyOwner,
    observedAt: Date
  ) => Promise<FindOwnedStudyResultOutcome>
  preloadOwned: (
    sessionId: string,
    owner: ExistingStudyOwner,
    observedAt: Date
  ) => Promise<OwnedStudySubmissionPreload | null>
  submitAtomic: (
    input: SubmitStudySessionAtomicInput
  ) => Promise<SubmitStudySessionAtomicResult>
}

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super('Idempotency key was already used for another request.')
    this.name = 'IdempotencyKeyReusedError'
  }
}

export class StudySessionAlreadySubmittedError extends Error {
  constructor() {
    super('Study session was already submitted.')
    this.name = 'StudySessionAlreadySubmittedError'
  }
}

export class StudySessionNotEditableError extends Error {
  constructor() {
    super('Study session is not editable.')
    this.name = 'StudySessionNotEditableError'
  }
}

export class StudySubmissionContractVersionMismatchError extends Error {
  constructor() {
    super('Submission contract version does not match the StudySession.')
    this.name = 'StudySubmissionContractVersionMismatchError'
  }
}

export class DraftSubmissionVersionConflictError extends Error {
  constructor() {
    super('Submission expectedDraftRevision is stale.')
    this.name = 'DraftSubmissionVersionConflictError'
  }
}

export class DraftSubmitMismatchError extends Error {
  constructor() {
    super('Submission answers do not match the authoritative draft.')
    this.name = 'DraftSubmitMismatchError'
  }
}

export class OwnedStudySessionNotFoundError extends Error {
  constructor() {
    super('Owned StudySession no longer exists.')
    this.name = 'OwnedStudySessionNotFoundError'
  }
}

export class StudySubmissionRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Study submission repository is unavailable.', options)
    this.name = 'StudySubmissionRepositoryUnavailableError'
  }
}

export class StudySubmissionRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StudySubmissionRepositoryIntegrityError'
  }
}

export class FreshTransactionRetry extends Error {
  constructor() {
    super('A fresh Serializable snapshot is required.')
    this.name = 'FreshTransactionRetry'
  }
}

export interface GuestProofRow {
  expiresAt: Date
  id: string
  lastSeenAt: Date
}

export interface LockedSessionRow {
  expiresAt: Date
  guestPrincipalId: string | null
  id: string
  practiceContractVersion: number
  status: StudySessionStatus
  userId: string | null
}

export interface LockedWrongNoteRow {
  correctStreak: number
  id: string
  lastReviewedAt: Date | null
  lastWrongAt: Date
  lastWrongQuestionVersionId: string
  questionId: string
  status: 'NEW' | 'REVIEWING' | 'AGAIN' | 'SOLVED'
  updatedAt: Date
  wrongCount: number
}

export interface AtomicQuestion {
  readonly correctOptionId: string
  readonly ordinal: number
  readonly optionIds: readonly string[]
  readonly questionId: string
  readonly questionVersionId: string
  readonly studySessionQuestionId: string
}

export interface AtomicSession {
  readonly draft: {
    readonly answers: readonly {
      readonly elapsedSec: number
      readonly selectedOptionId: string | null
      readonly studySessionQuestionId: string
    }[]
    readonly revision: number
  } | null
  readonly expiresAt: Date
  readonly mode:
    | 'RANDOM'
    | 'WRONG_NOTE'
    | 'WEAKNESS'
    | 'BOOKMARK'
    | 'DAILY_REVIEW'
  readonly questions: readonly AtomicQuestion[]
  readonly practiceContractVersion: number
  readonly startedAt: Date
  readonly status: StudySessionStatus
}
