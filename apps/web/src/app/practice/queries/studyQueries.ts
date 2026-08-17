import { studyResultQueries } from '@app/practice/queries/studyResultQueries'
import {
  studySessionMutations,
  studySessionQueries
} from '@app/practice/queries/studySessionQueries'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'

export const studyQueries = {
  allKey: serverStateQueryKeys.study.all,
  session: studySessionQueries.session,
  result: studyResultQueries.result
} as const

export const studyMutations = {
  createSession: studySessionMutations.createSession
} as const
