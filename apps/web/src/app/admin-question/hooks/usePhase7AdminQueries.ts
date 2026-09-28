import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type {
  DiffQuestionVersionQuery,
  ListAdminAuditLogQuery,
  ListAdminQuestionReportsQuery,
  ListAdminQuestionsQuery,
  ListAdminTagsQuery,
  ListQuestionVersionReviewsQuery
} from '@nihongo/contracts/admin/phase7'
import { phase7AdminQueries } from '@app/admin-question/queries/phase7AdminQueries'

export const usePhase7AdminQuestionList = (query: ListAdminQuestionsQuery) =>
  useQuery(phase7AdminQueries.questionList(query))

export const usePhase7AdminQuestionDetail = (questionId: string) =>
  useQuery(phase7AdminQueries.questionDetail(questionId))

export const usePhase7AdminQuestionVersions = (
  questionId: string,
  limit = 20,
  enabled = true
) =>
  useInfiniteQuery({
    ...phase7AdminQueries.versionHistoryConnection(questionId, limit),
    enabled
  })

export const usePhase7AdminQuestionPreview = (
  versionId: string,
  enabled = true
) =>
  useQuery({
    ...phase7AdminQueries.preview(versionId),
    enabled
  })

export const usePhase7AdminQuestionReviews = (
  versionId: string,
  query: ListQuestionVersionReviewsQuery,
  enabled = true
) =>
  useQuery({
    ...phase7AdminQueries.reviews(versionId, query),
    enabled
  })

export const usePhase7AdminQuestionReviewConnection = (
  versionId: string,
  limit = 20,
  enabled = true
) =>
  useInfiniteQuery({
    ...phase7AdminQueries.reviewConnection(versionId, limit),
    enabled
  })

export const usePhase7AdminQuestionDiff = (
  versionId: string,
  query: DiffQuestionVersionQuery,
  enabled: boolean
) =>
  useQuery({
    ...phase7AdminQueries.diff(versionId, query),
    enabled
  })

export const usePhase7AdminTags = (
  query: ListAdminTagsQuery,
  enabled: boolean
) =>
  useQuery({
    ...phase7AdminQueries.tags(query),
    enabled
  })

export const usePhase7AdminAuditLog = (query: ListAdminAuditLogQuery) =>
  useQuery(phase7AdminQueries.auditLog(query))

export const usePhase7AdminAuditLogConnection = (
  query: Omit<ListAdminAuditLogQuery, 'cursor'>
) => useInfiniteQuery(phase7AdminQueries.auditLogConnection(query))

export const usePhase7AdminQuestionReportList = (
  query: ListAdminQuestionReportsQuery
) => useQuery(phase7AdminQueries.reportList(query))

export const usePhase7AdminQuestionReportDetail = (reportId: string) =>
  useQuery(phase7AdminQueries.reportDetail(reportId))
