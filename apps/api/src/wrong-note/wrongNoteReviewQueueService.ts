import type {
  ListReviewQueueResponse,
  ParsedListReviewQueueQuery,
  ReviewQueueItem
} from '@nihongo/contracts/wrong-note/list-review-queue'
import { compareWrongNoteTagLabels } from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { ApplicationError } from '../errors/applicationError.js'
import { createWrongNoteQuestionPreview } from './wrongNoteMapper.js'
import {
  WrongNoteReviewQueueRepositoryIntegrityError,
  WrongNoteReviewQueueRepositoryUnavailableError,
  type ReviewQueueRecord,
  type WrongNoteReviewQueueRepository
} from './wrongNoteReviewQueueRepository.js'

export interface WrongNoteReviewQueueService {
  listReviewQueue: (
    userId: string,
    query: ParsedListReviewQueueQuery
  ) => Promise<ListReviewQueueResponse>
}

const toItem = (record: ReviewQueueRecord): ReviewQueueItem => ({
  questionId: record.questionId,
  currentQuestionVersionId: record.currentQuestionVersionId,
  level: record.level,
  subject: record.subject,
  questionType: record.questionType,
  questionPreview: createWrongNoteQuestionPreview(record.questionPreview),
  tags: [...record.tags].toSorted(compareWrongNoteTagLabels),
  status: record.status,
  wrongCount: record.wrongCount,
  correctStreak: record.correctStreak,
  lastWrongAt: record.lastWrongAt.toISOString(),
  lastReviewedAt: record.lastReviewedAt?.toISOString() ?? null,
  nextReviewAt: record.nextReviewAt.toISOString(),
  hasMemo: record.hasMemo
})

const withMappedErrors = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof WrongNoteReviewQueueRepositoryUnavailableError) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '복습 대기열 저장소에 연결할 수 없습니다.',
        retryable: true,
        cause: error
      })
    }
    if (error instanceof WrongNoteReviewQueueRepositoryIntegrityError) {
      throw new ApplicationError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '복습 대기열 데이터 무결성을 확인하지 못했습니다.',
        retryable: true,
        cause: error
      })
    }
    throw error
  }
}

export const createWrongNoteReviewQueueService = (
  repository: WrongNoteReviewQueueRepository,
  now?: () => Date
): WrongNoteReviewQueueService => ({
  listReviewQueue: (userId, query) =>
    withMappedErrors(async () => {
      const result = await repository.listOwned({
        ...query,
        userId,
        ...(now ? { observedAt: now() } : {})
      })
      return {
        items: result.items.map(toItem),
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        counts: result.counts,
        availableTags: [...result.availableTags].toSorted(
          compareWrongNoteTagLabels
        ),
        observedAt: result.observedAt.toISOString()
      }
    })
})
