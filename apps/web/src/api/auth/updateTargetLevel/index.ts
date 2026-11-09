import { safePut } from '@nihongo/browser/api/http'
import type { UpdateTargetLevelBody } from '@nihongo/contracts/auth/update-target-level'
import {
  updateTargetLevelBodySchema,
  updateTargetLevelResponseSchema
} from '@api/auth/updateTargetLevel/schema'
const request = safePut(updateTargetLevelResponseSchema)
export const updateTargetLevel = (input: UpdateTargetLevelBody) =>
  request('/v1/me/target-level', updateTargetLevelBodySchema.parse(input))
