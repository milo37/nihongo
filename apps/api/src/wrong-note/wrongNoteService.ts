import type { GetWrongNoteResponse } from '@nihongo/contracts/wrong-note/get-wrong-note'
import {
  trimWrongNoteTagLabel,
  type ListWrongNotesResponse,
  type ParsedListWrongNotesQuery
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { ApplicationError } from '../errors/applicationError.js'
import {
  toListWrongNotesResponse,
  toWrongNoteDetail,
  WrongNoteMapperIntegrityError
} from './wrongNoteMapper.js'
import {
  WrongNoteRepositoryIntegrityError,
  WrongNoteRepositoryUnavailableError,
  type WrongNoteRepository
} from './wrongNoteRepository.js'

export interface WrongNoteService {
  getWrongNote: (
    userId: string,
    questionId: string
  ) => Promise<GetWrongNoteResponse>
  listWrongNotes: (
    userId: string,
    query: ParsedListWrongNotesQuery
  ) => Promise<ListWrongNotesResponse>
}

const throwMappedError = (error: unknown): never => {
  if (error instanceof WrongNoteRepositoryUnavailableError) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '오답 노트 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (
    error instanceof WrongNoteRepositoryIntegrityError ||
    error instanceof WrongNoteMapperIntegrityError
  ) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '오답 노트 무결성을 확인하지 못했습니다.',
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

export const createWrongNoteService = (
  repository: WrongNoteRepository
): WrongNoteService => ({
  getWrongNote: (userId, questionId) =>
    withMappedErrors(async () => {
      const record = await repository.findOwnedDetail(userId, questionId)
      if (!record) {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '오답 노트를 찾을 수 없습니다.',
          retryable: false
        })
      }
      return toWrongNoteDetail(record)
    }),
  listWrongNotes: (userId, query) =>
    withMappedErrors(async () => {
      const result = await repository.listOwned({
        userId,
        ...query,
        ...(query.tag ? { tag: trimWrongNoteTagLabel(query.tag) } : {})
      })
      return toListWrongNotesResponse(
        result.items,
        result.availableTagLabels,
        query.page,
        query.pageSize,
        result.total
      )
    })
})
