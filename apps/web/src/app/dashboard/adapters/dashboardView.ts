import type { GetDashboardStatsResponse } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import type { GetDashboardStatsResponse as LegacyDashboardStatsResponse } from '@api/dashboard/getDashboardStats/schema'

export type DashboardView = LegacyDashboardStatsResponse

export const toLegacyDashboardView = (
  response: LegacyDashboardStatsResponse
): DashboardView => response

export const toCanonicalDashboardView = (
  response: GetDashboardStatsResponse
): DashboardView => ({
  totalAnsweredCount: response.totalAnsweredCount,
  correctCount: response.correctCount,
  correctRate: response.correctRate,
  wrongNoteCount: response.wrongNoteCount,
  solvedWrongNoteCount: response.solvedWrongNoteCount,
  weakestSubject: response.weakestSubject,
  subjectStats: response.subjectStats,
  recentStudySessions: response.recentStudySessions,
  dailyStudyCountLast7Days: response.dailyStudyCountLast7Days,
  repeatedWrongQuestions: response.repeatedWrongQuestions.map((question) => ({
    questionId: question.questionId,
    questionText: question.questionPreview,
    level: question.level,
    subject: question.subject,
    wrongCount: question.wrongCount
  }))
})
