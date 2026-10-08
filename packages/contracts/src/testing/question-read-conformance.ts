import type { ListQuestionsQuery } from '../question/list-questions.js'

export interface QuestionListConformanceCase {
  readonly query: ListQuestionsQuery
  readonly expectedQuestionIds: readonly string[]
  readonly expectedTotal: number
}

export const spacedTagQuestionListCase: QuestionListConformanceCase = {
  query: { tag: '한자   읽기', pageSize: 100 },
  expectedQuestionIds: [
    '3454d64b-234e-4c73-87d0-1e7829c890b7',
    '565d941a-3f60-4e7d-8d87-01a467eacfad',
    'bcbd22b5-8248-40a1-8ca1-b81d752b3f11',
    'dae5c5b7-47e6-43be-82f2-7de9745c3b58',
    'ef828615-9edb-40e4-8a9d-7f10e6189f6a'
  ],
  expectedTotal: 5
}
