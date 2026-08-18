import type { StudyDraftCleanupResult } from './studyDraftCleanupRepository.js'

interface StudyDraftCleanupSuccessLog extends StudyDraftCleanupResult {
  readonly batchSize: number
  readonly event: 'study.expired_drafts.cleaned'
}

interface StudyDraftCleanupFailureLog {
  readonly errorName: string
  readonly event: 'study.expired_drafts.cleanup_failed'
}

export const createStudyDraftCleanupSuccessLog = (
  batchSize: number,
  result: StudyDraftCleanupResult
): StudyDraftCleanupSuccessLog => ({
  event: 'study.expired_drafts.cleaned',
  batchSize,
  ...result
})

export const createStudyDraftCleanupFailureLog = (
  error: unknown
): StudyDraftCleanupFailureLog => ({
  event: 'study.expired_drafts.cleanup_failed',
  errorName: error instanceof Error ? error.name : 'UnknownError'
})
