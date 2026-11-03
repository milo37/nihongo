import type {
  AdminReportDetail,
  AdminReportSummary,
  ListAdminReportsResponse
} from '@nihongo/contracts/admin/reports'
import type {
  CreateReportResponse,
  ListMyReportsResponse,
  MyReport
} from '@nihongo/contracts/report/reports'
import type { z } from 'zod'
import type {
  closeAdminReportRequestSchema,
  listAdminReportsQuerySchema,
  replyAndCloseAdminReportRequestSchema,
  saveAdminReportNoteRequestSchema
} from '@nihongo/contracts/admin/reports'
import type {
  createReportRequestSchema,
  listMyReportsQuerySchema
} from '@nihongo/contracts/report/reports'
import { ApplicationError } from '../errors/applicationError.js'
import {
  UserReportRepositoryUnavailableError,
  type UserReportCommand,
  type UserReportRecord,
  type UserReportRepository
} from './userReportRepository.js'

type CreateReportInput = z.output<typeof createReportRequestSchema>
type ListMyReportsInput = z.output<typeof listMyReportsQuerySchema>
type ListAdminReportsInput = z.output<typeof listAdminReportsQuerySchema>
type ReplyAndCloseInput = z.output<typeof replyAndCloseAdminReportRequestSchema>
type SaveNoteInput = z.output<typeof saveAdminReportNoteRequestSchema>
type CloseInput = z.output<typeof closeAdminReportRequestSchema>

export interface UserReportService {
  readonly createReport: (
    reporterUserId: string,
    request: CreateReportInput
  ) => Promise<CreateReportResponse>
  readonly listMyReports: (
    reporterUserId: string,
    query: ListMyReportsInput
  ) => Promise<ListMyReportsResponse>
  readonly listAdminReports: (
    query: ListAdminReportsInput
  ) => Promise<ListAdminReportsResponse>
  readonly getAdminReport: (reportId: string) => Promise<AdminReportDetail>
  readonly replyAndClose: (
    reportId: string,
    request: ReplyAndCloseInput
  ) => Promise<AdminReportDetail>
  readonly saveNote: (
    reportId: string,
    request: SaveNoteInput
  ) => Promise<AdminReportDetail>
  readonly close: (
    reportId: string,
    request: CloseInput
  ) => Promise<AdminReportDetail>
}

const PREVIEW_MAX_SCALARS = 160

/** One line, at most 160 scalars; the full text stays in the detail view. */
export const toDescriptionPreview = (description: string): string =>
  [...description.replace(/\s+/gu, ' ').trim()]
    .slice(0, PREVIEW_MAX_SCALARS)
    .join('')
    .trimEnd()

const iso = (value: Date | null): string | null => value?.toISOString() ?? null

const toSummary = (record: UserReportRecord): AdminReportSummary => ({
  reportId: record.id,
  kind: record.kind,
  status: record.status,
  location: record.location,
  questionId: record.questionId,
  questionVersionId: record.questionVersionId,
  descriptionPreview: toDescriptionPreview(record.description),
  reporterMemberId: record.reporterUserId,
  createdAt: record.createdAt.toISOString(),
  rowVersion: record.rowVersion
})

const toDetail = (record: UserReportRecord): AdminReportDetail => {
  const { descriptionPreview: _preview, ...summary } = toSummary(record)
  return {
    ...summary,
    description: record.description,
    reporterReply: record.reporterReply,
    repliedAt: iso(record.repliedAt),
    internalNote: record.internalNote,
    closedAt: iso(record.closedAt),
    updatedAt: record.updatedAt.toISOString()
  }
}

/** Learner view never includes the admin internal note. */
const toMyReport = (record: UserReportRecord): MyReport => ({
  reportId: record.id,
  kind: record.kind,
  createdAt: record.createdAt.toISOString(),
  status: record.status,
  reporterReply: record.reporterReply,
  repliedAt: iso(record.repliedAt)
})

const failure = (
  code:
    | 'RESOURCE_NOT_FOUND'
    | 'VERSION_CONFLICT'
    | 'INVALID_STATE_TRANSITION'
    | 'QUESTION_NOT_AVAILABLE'
    | 'QUESTION_REPORT_DUPLICATE',
  message: string
): never => {
  throw new ApplicationError({ code, message, retryable: false })
}

const withRepositoryErrors = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof UserReportRepositoryUnavailableError) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '제보 저장소에 연결할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5,
        cause: error
      })
    }
    throw error
  }
}

/** An empty note clears it; an omitted note keeps the stored one. */
const toStoredNote = (note: string): string | null =>
  note.length === 0 ? null : note

export const createUserReportService = (
  repository: UserReportRepository
): UserReportService => {
  const runCommand = (
    reportId: string,
    expectedRowVersion: number,
    command: UserReportCommand
  ) =>
    withRepositoryErrors(async () => {
      const outcome = await repository.applyCommand({
        reportId,
        expectedRowVersion,
        command
      })
      switch (outcome.kind) {
        case 'UPDATED':
          return toDetail(outcome.record)
        case 'NOT_FOUND':
          return failure('RESOURCE_NOT_FOUND', '제보를 찾을 수 없습니다.')
        case 'CLOSED':
          return failure('INVALID_STATE_TRANSITION', '이미 종결된 제보입니다.')
        case 'VERSION_CONFLICT':
          return failure(
            'VERSION_CONFLICT',
            '다른 요청이 먼저 제보를 변경했습니다.'
          )
      }
    })

  return {
    createReport: (reporterUserId, request) =>
      withRepositoryErrors(async () => {
        const outcome = await repository.create({
          kind: request.kind,
          location: request.location,
          questionId: request.questionId ?? null,
          questionVersionId: request.questionVersionId ?? null,
          description: request.description,
          reporterUserId
        })
        if (outcome.kind === 'QUESTION_NOT_AVAILABLE') {
          return failure(
            'QUESTION_NOT_AVAILABLE',
            '제보할 수 있는 문항이 아닙니다.'
          )
        }
        if (outcome.kind === 'DUPLICATE') {
          return failure(
            'QUESTION_REPORT_DUPLICATE',
            '이미 접수된 같은 문항 제보가 있습니다.'
          )
        }
        return {
          reportId: outcome.record.id,
          status: 'RECEIVED',
          createdAt: outcome.record.createdAt.toISOString()
        }
      }),
    listMyReports: (reporterUserId, query) =>
      withRepositoryErrors(async () => {
        const page = await repository.listByReporter({
          reporterUserId,
          page: query.page,
          pageSize: query.pageSize
        })
        return {
          items: page.items.map(toMyReport),
          page: query.page,
          pageSize: query.pageSize,
          total: page.total
        }
      }),
    listAdminReports: (query) =>
      withRepositoryErrors(async () => {
        const page = await repository.listForAdmin({
          status: query.status,
          kind: query.kind,
          page: query.page,
          pageSize: query.pageSize
        })
        return {
          items: page.items.map(toSummary),
          page: query.page,
          pageSize: query.pageSize,
          total: page.total
        }
      }),
    getAdminReport: (reportId) =>
      withRepositoryErrors(async () => {
        const record = await repository.get(reportId)
        return record
          ? toDetail(record)
          : failure('RESOURCE_NOT_FOUND', '제보를 찾을 수 없습니다.')
      }),
    replyAndClose: (reportId, request) =>
      runCommand(reportId, request.expectedRowVersion, {
        kind: 'REPLY_AND_CLOSE',
        reporterReply: request.reporterReply,
        internalNote:
          request.internalNote === undefined
            ? undefined
            : toStoredNote(request.internalNote)
      }),
    saveNote: (reportId, request) =>
      runCommand(reportId, request.expectedRowVersion, {
        kind: 'SAVE_NOTE',
        internalNote: toStoredNote(request.internalNote)
      }),
    close: (reportId, request) =>
      runCommand(reportId, request.expectedRowVersion, {
        kind: 'CLOSE',
        internalNote:
          request.internalNote === undefined
            ? undefined
            : toStoredNote(request.internalNote)
      })
  }
}
