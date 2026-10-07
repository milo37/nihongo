import {
  listAdminAuditLogQuerySchema,
  listAdminQuestionReportsQuerySchema,
  listAdminQuestionsQuerySchema,
  listAdminQuestionVersionsQuerySchema,
  listAdminTagsQuerySchema,
  listQuestionVersionReviewsQuerySchema,
  type DiffQuestionVersionQuery,
  type ListAdminAuditLogQuery,
  type ListAdminQuestionReportsQuery,
  type ListAdminQuestionsQuery,
  type ListAdminQuestionVersionsQuery,
  type ListAdminTagsQuery,
  type ListQuestionVersionReviewsQuery
} from '@nihongo/contracts/admin/phase7'
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions
} from '@tanstack/react-query'
import {
  diffPhase7QuestionVersion,
  getPhase7AdminQuestion,
  getPhase7AdminQuestionReport,
  listPhase7AdminAuditLog,
  listPhase7AdminQuestionReports,
  listPhase7AdminQuestions,
  listPhase7AdminQuestionVersions,
  listPhase7AdminTags,
  listPhase7QuestionVersionReviews,
  previewPhase7QuestionVersion
} from '@api/phase7/phase7AdminApi'
import { adminQuestionReportKeys } from '@app/content-operations/reports/queries/questionReportKeys'

const rootKey = ['phase7-admin'] as const

export const adminQuestionKeys = {
  all: () => [...rootKey, 'questions'] as const,
  allLists: () => [...adminQuestionKeys.all(), 'list'] as const,
  list: (query: ListAdminQuestionsQuery) =>
    [...adminQuestionKeys.allLists(), query] as const,
  details: () => [...adminQuestionKeys.all(), 'detail'] as const,
  detail: (questionId: string) =>
    [...adminQuestionKeys.details(), questionId] as const
} as const

export const adminQuestionVersionKeys = {
  all: () => [...rootKey, 'question-versions'] as const,
  histories: () => [...adminQuestionVersionKeys.all(), 'history'] as const,
  historyFamily: (questionId: string) =>
    [...adminQuestionVersionKeys.histories(), questionId] as const,
  history: (questionId: string, query: ListAdminQuestionVersionsQuery) =>
    [...adminQuestionVersionKeys.historyFamily(questionId), query] as const,
  reviews: (versionId: string, query: ListQuestionVersionReviewsQuery) =>
    [...adminQuestionVersionKeys.all(), 'reviews', versionId, query] as const,
  reviewFamily: (versionId: string) =>
    [...adminQuestionVersionKeys.all(), 'reviews', versionId] as const,
  previews: () => [...adminQuestionVersionKeys.all(), 'preview'] as const,
  preview: (versionId: string) =>
    [...adminQuestionVersionKeys.previews(), versionId] as const,
  diffs: () => [...adminQuestionVersionKeys.all(), 'diff'] as const,
  diffFamily: (versionId: string) =>
    [...adminQuestionVersionKeys.diffs(), versionId] as const,
  diff: (versionId: string, query: DiffQuestionVersionQuery) =>
    [...adminQuestionVersionKeys.diffFamily(versionId), query] as const
} as const

export const adminAuditLogKeys = {
  all: () => [...rootKey, 'audit-log'] as const,
  allLists: () => [...adminAuditLogKeys.all(), 'list'] as const,
  list: (query: ListAdminAuditLogQuery) =>
    [...adminAuditLogKeys.allLists(), query] as const
} as const

export { adminQuestionReportKeys }

export const adminTagKeys = {
  all: () => [...rootKey, 'tags'] as const,
  search: (query: ListAdminTagsQuery) =>
    [...adminTagKeys.all(), 'search', query] as const
} as const

export const phase7AdminQueries = {
  questionList: (input: ListAdminQuestionsQuery) => {
    const query = listAdminQuestionsQuerySchema.parse(input)
    return queryOptions({
      queryKey: adminQuestionKeys.list(query),
      queryFn: () => listPhase7AdminQuestions(query),
      placeholderData: keepPreviousData,
      staleTime: 15_000
    })
  },
  questionDetail: (questionId: string) =>
    queryOptions({
      queryKey: adminQuestionKeys.detail(questionId),
      queryFn: () => getPhase7AdminQuestion(questionId),
      enabled: questionId.length > 0
    }),
  tags: (input: ListAdminTagsQuery) => {
    const query = listAdminTagsQuerySchema.parse(input)
    return queryOptions({
      queryKey: adminTagKeys.search(query),
      queryFn: () => listPhase7AdminTags(query),
      staleTime: 30_000
    })
  },
  versionHistory: (
    questionId: string,
    input: ListAdminQuestionVersionsQuery
  ) => {
    const query = listAdminQuestionVersionsQuerySchema.parse(input)
    return queryOptions({
      queryKey: adminQuestionVersionKeys.history(questionId, query),
      queryFn: () => listPhase7AdminQuestionVersions(questionId, query),
      enabled: questionId.length > 0
    })
  },
  versionHistoryConnection: (questionId: string, limit = 20) =>
    infiniteQueryOptions({
      queryKey: [
        ...adminQuestionVersionKeys.histories(),
        questionId,
        { limit }
      ] as const,
      queryFn: ({ pageParam }) =>
        listPhase7AdminQuestionVersions(questionId, {
          limit,
          ...(pageParam === null ? {} : { cursor: pageParam })
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      enabled: questionId.length > 0
    }),
  reviews: (versionId: string, input: ListQuestionVersionReviewsQuery) => {
    const query = listQuestionVersionReviewsQuerySchema.parse(input)
    return queryOptions({
      queryKey: adminQuestionVersionKeys.reviews(versionId, query),
      queryFn: () => listPhase7QuestionVersionReviews(versionId, query),
      enabled: versionId.length > 0
    })
  },
  reviewConnection: (versionId: string, limit = 20) =>
    infiniteQueryOptions({
      queryKey: [
        ...adminQuestionVersionKeys.all(),
        'reviews',
        versionId,
        { limit }
      ] as const,
      queryFn: ({ pageParam }) =>
        listPhase7QuestionVersionReviews(versionId, {
          limit,
          ...(pageParam === null ? {} : { cursor: pageParam })
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      enabled: versionId.length > 0
    }),
  preview: (versionId: string) =>
    queryOptions({
      queryKey: adminQuestionVersionKeys.preview(versionId),
      queryFn: () => previewPhase7QuestionVersion(versionId),
      enabled: versionId.length > 0
    }),
  diff: (versionId: string, query: DiffQuestionVersionQuery) =>
    queryOptions({
      queryKey: adminQuestionVersionKeys.diff(versionId, query),
      queryFn: () => diffPhase7QuestionVersion(versionId, query),
      enabled: versionId.length > 0 && query.baseVersionId.length > 0
    }),
  auditLog: (input: ListAdminAuditLogQuery) => {
    const query = listAdminAuditLogQuerySchema.parse(input)
    return queryOptions({
      queryKey: adminAuditLogKeys.list(query),
      queryFn: () => listPhase7AdminAuditLog(query),
      staleTime: 15_000
    })
  },
  auditLogConnection: (input: Omit<ListAdminAuditLogQuery, 'cursor'>) => {
    const query = listAdminAuditLogQuerySchema.parse(input)
    return infiniteQueryOptions({
      queryKey: [...adminAuditLogKeys.allLists(), 'connection', query] as const,
      queryFn: ({ pageParam }) =>
        listPhase7AdminAuditLog({
          ...query,
          ...(pageParam === null ? {} : { cursor: pageParam })
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: 15_000
    })
  },
  reportList: (input: ListAdminQuestionReportsQuery) => {
    const query = listAdminQuestionReportsQuerySchema.parse(input)
    return queryOptions({
      queryKey: adminQuestionReportKeys.list(query),
      queryFn: () => listPhase7AdminQuestionReports(query),
      placeholderData: keepPreviousData,
      staleTime: 15_000
    })
  },
  reportDetail: (reportId: string) =>
    queryOptions({
      queryKey: adminQuestionReportKeys.detail(reportId),
      queryFn: () => getPhase7AdminQuestionReport(reportId),
      enabled: reportId.length > 0
    })
} as const
