import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

export interface QuestionTagRecord {
  id: string
  label: string
}

export interface QuestionOptionRecord {
  id: string
  label: string
  text: string
}

export interface PublishedQuestionSummaryRecord {
  id: string
  questionVersionId: string
  level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  subject: 'VOCABULARY' | 'GRAMMAR' | 'READING'
  questionType:
    | 'KANJI_READING'
    | 'ORTHOGRAPHY'
    | 'CONTEXT_VOCABULARY'
    | 'PARAPHRASE'
    | 'WORD_USAGE'
    | 'GRAMMAR_SELECT'
    | 'SENTENCE_ORDER'
    | 'TEXT_GRAMMAR'
    | 'SHORT_READING'
    | 'MEDIUM_READING'
    | 'LONG_READING'
    | 'INFO_RETRIEVAL'
  difficulty: 'EASY' | 'NORMAL' | 'HARD'
  questionText: string
  tags: readonly QuestionTagRecord[]
}

export interface PublishedQuestionDetailRecord
  extends PublishedQuestionSummaryRecord {
  passage: string | null
  options: readonly QuestionOptionRecord[]
}

export interface ListPublishedQuestionsInput {
  level?: PublishedQuestionSummaryRecord['level']
  subject?: PublishedQuestionSummaryRecord['subject']
  type?: PublishedQuestionSummaryRecord['questionType']
  difficulty?: PublishedQuestionSummaryRecord['difficulty']
  normalizedTag?: string
  page: number
  pageSize: number
}

export interface ListPublishedQuestionsResult {
  items: readonly PublishedQuestionSummaryRecord[]
  total: number
}

export interface QuestionRepository {
  findPublishedById: (
    questionId: string
  ) => Promise<PublishedQuestionDetailRecord | null>
  listPublished: (
    input: ListPublishedQuestionsInput
  ) => Promise<ListPublishedQuestionsResult>
}

export class QuestionRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Question repository is unavailable.', options)
    this.name = 'QuestionRepositoryUnavailableError'
  }
}

export class QuestionRepositoryIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuestionRepositoryIntegrityError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

const toTags = (
  tags: readonly { tagId: string; labelSnapshot: string }[]
): readonly QuestionTagRecord[] =>
  tags.map(({ labelSnapshot, tagId }) => ({
    id: tagId,
    label: labelSnapshot
  }))

const executeRepositoryOperation = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (isDatabaseUnavailableError(error)) {
      throw new QuestionRepositoryUnavailableError({ cause: error })
    }

    throw error
  }
}

export const createPrismaQuestionRepository = (
  client: PrismaClient | Prisma.TransactionClient
): QuestionRepository => ({
  findPublishedById: (questionId) =>
    executeRepositoryOperation(async () => {
      const question = await client.question.findFirst({
        where: {
          id: questionId,
          lifecycleStatus: 'ACTIVE',
          currentPublishedVersion: { is: { status: 'PUBLISHED' } }
        },
        select: {
          id: true,
          currentPublishedVersion: {
            select: {
              id: true,
              level: true,
              subject: true,
              questionType: true,
              passage: true,
              questionText: true,
              difficulty: true,
              options: {
                orderBy: { ordinal: 'asc' },
                select: { id: true, label: true, text: true }
              },
              tags: {
                orderBy: { labelSnapshot: 'asc' },
                select: { tagId: true, labelSnapshot: true }
              }
            }
          }
        }
      })

      if (!question) {
        return null
      }

      const version = question.currentPublishedVersion

      if (!version) {
        throw new QuestionRepositoryIntegrityError(
          'Active question has no current published version.'
        )
      }

      return {
        id: question.id,
        questionVersionId: version.id,
        level: version.level,
        subject: version.subject,
        questionType: version.questionType,
        passage: version.passage,
        questionText: version.questionText,
        difficulty: version.difficulty,
        options: version.options,
        tags: toTags(version.tags)
      }
    }),
  listPublished: (input) =>
    executeRepositoryOperation(async () => {
      const versionWhere = {
        status: 'PUBLISHED' as const,
        ...(input.level ? { level: input.level } : {}),
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.type ? { questionType: input.type } : {}),
        ...(input.difficulty ? { difficulty: input.difficulty } : {}),
        ...(input.normalizedTag
          ? {
              tags: {
                some: {
                  tag: { normalizedName: input.normalizedTag }
                }
              }
            }
          : {})
      }
      const where = {
        lifecycleStatus: 'ACTIVE' as const,
        currentPublishedVersion: { is: versionWhere }
      }
      const [questions, total] = await Promise.all([
        client.question.findMany({
          where,
          orderBy: { id: 'asc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          select: {
            id: true,
            currentPublishedVersion: {
              select: {
                id: true,
                level: true,
                subject: true,
                questionType: true,
                questionText: true,
                difficulty: true,
                tags: {
                  orderBy: { labelSnapshot: 'asc' },
                  select: { tagId: true, labelSnapshot: true }
                }
              }
            }
          }
        }),
        client.question.count({ where })
      ])

      return {
        total,
        items: questions.map((question) => {
          const version = question.currentPublishedVersion

          if (!version) {
            throw new QuestionRepositoryIntegrityError(
              'Active question has no current published version.'
            )
          }

          return {
            id: question.id,
            questionVersionId: version.id,
            level: version.level,
            subject: version.subject,
            questionType: version.questionType,
            difficulty: version.difficulty,
            questionText: version.questionText,
            tags: toTags(version.tags)
          }
        })
      }
    })
})
