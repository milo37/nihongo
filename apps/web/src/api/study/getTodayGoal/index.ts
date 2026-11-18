import { safeGet } from '@nihongo/browser/api/http'
import { todayGoalResponseSchema } from '@api/study/getTodayGoal/schema'
const request = safeGet(todayGoalResponseSchema)
// The same member route as the study goal page (GET /me/study-goal).
export const getTodayGoal = () => request('/v1/me/study-goal')
