import { safeGet, safePost, safePut } from '@nihongo/browser/api/http'
import type { UpdateStudyGoalBody } from '@nihongo/contracts/auth/study-goal'
import { studyGoalResponseSchema } from '@api/auth/studyGoal/schema'
const read = safeGet(studyGoalResponseSchema)
const write = safePut(studyGoalResponseSchema)
const skip = safePost(studyGoalResponseSchema)
// #1090: members only; every call answers with the whole study goal.
export const getStudyGoal = () => read('/v1/me/study-goal')
export const updateStudyGoal = (body: UpdateStudyGoalBody) =>
  write('/v1/me/study-goal', body)
export const skipStudyGoal = () => skip('/v1/me/study-goal/skip', {})
