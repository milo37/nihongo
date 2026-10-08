import { randomUUID } from 'node:crypto'
import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import type {
  ListBookmarksResponse,
  ParsedListBookmarksQuery
} from '@nihongo/contracts/bookmark/list-bookmarks'
import { ApplicationError } from '../errors/applicationError.js'
import { toBookmarkSummary } from './bookmarkMapper.js'
import {
  BookmarkQuestionNotAvailableError,
  BookmarkQuestionNotFoundError,
  BookmarkRepositoryIntegrityError,
  BookmarkRepositoryUnavailableError,
  type BookmarkRepository
} from './bookmarkRepository.js'

export interface BookmarkService {
  create: (
    userId: string,
    questionId: string
  ) => Promise<{ bookmark: BookmarkSummary; created: boolean }>
  delete: (userId: string, questionId: string) => Promise<void>
  list: (
    userId: string,
    query: ParsedListBookmarksQuery
  ) => Promise<ListBookmarksResponse>
}

const throwMappedError = (error: unknown): never => {
  if (error instanceof BookmarkQuestionNotFoundError) {
    throw new ApplicationError({
      code: 'RESOURCE_NOT_FOUND',
      message: '문제를 찾을 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof BookmarkQuestionNotAvailableError) {
    throw new ApplicationError({
      code: 'QUESTION_NOT_AVAILABLE',
      message: '현재 공개 중인 문제만 즐겨찾기에 추가할 수 있습니다.',
      retryable: false
    })
  }
  if (error instanceof BookmarkRepositoryUnavailableError) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '즐겨찾기 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (error instanceof BookmarkRepositoryIntegrityError) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '즐겨찾기 무결성을 확인하지 못했습니다.',
      retryable: true,
      cause: error
    })
  }
  throw error
}

const withMappedErrors = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    return throwMappedError(error)
  }
}

export const createBookmarkService = (
  repository: BookmarkRepository,
  now: () => Date = () => new Date(),
  createId: () => string = randomUUID
): BookmarkService => ({
  create: (userId, questionId) =>
    withMappedErrors(async () => {
      const result = await repository.createOwned({
        id: createId(),
        userId,
        questionId,
        createdAt: now()
      })
      return {
        bookmark: toBookmarkSummary(result.bookmark),
        created: result.created
      }
    }),
  delete: (userId, questionId) =>
    withMappedErrors(() => repository.deleteOwned(userId, questionId)),
  list: (userId, query) =>
    withMappedErrors(async () => {
      const result = await repository.listOwned({ userId, ...query })
      return {
        items: result.items.map(toBookmarkSummary),
        page: query.page,
        pageSize: query.pageSize,
        total: result.total
      }
    })
})
