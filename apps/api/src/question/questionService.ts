import {
  normalizeQuestionTagText,
  type GetQuestionResponse
} from '@nihongo/contracts/question/get-question'
import type {
  ListQuestionsResponse,
  ParsedListQuestionsQuery
} from '@nihongo/contracts/question/list-questions'
import { ApplicationError } from '../errors/applicationError.js'
import {
  QuestionRepositoryUnavailableError,
  type QuestionRepository
} from './questionRepository.js'
import {
  toListQuestionsResponse,
  toPublicPracticeQuestion
} from './questionMapper.js'

export interface QuestionReader {
  getQuestion: (questionId: string) => Promise<GetQuestionResponse>
  listQuestions: (
    query: ParsedListQuestionsQuery
  ) => Promise<ListQuestionsResponse>
}

const withRepositoryAvailability = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof QuestionRepositoryUnavailableError) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '문제 목록 저장소에 연결할 수 없습니다.',
        retryable: true,
        cause: error
      })
    }

    throw error
  }
}

export const createQuestionService = (
  repository: QuestionRepository
): QuestionReader => ({
  getQuestion: (questionId) =>
    withRepositoryAvailability(async () => {
      const question = await repository.findPublishedById(questionId)

      if (!question) {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제를 찾을 수 없습니다.',
          retryable: false
        })
      }

      return toPublicPracticeQuestion(question)
    }),
  listQuestions: (query) =>
    withRepositoryAvailability(async () => {
      const result = await repository.listPublished({
        ...(query.level ? { level: query.level } : {}),
        ...(query.subject ? { subject: query.subject } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.difficulty ? { difficulty: query.difficulty } : {}),
        ...(query.tag
          ? { normalizedTag: normalizeQuestionTagText(query.tag) }
          : {}),
        page: query.page,
        pageSize: query.pageSize
      })

      return toListQuestionsResponse(
        result.items,
        query.page,
        query.pageSize,
        result.total
      )
    })
})
