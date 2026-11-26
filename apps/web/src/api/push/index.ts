import { safeDel, safeGet, safePut } from '@nihongo/browser/api/http'
import type {
  DeletePushSubscriptionRequest,
  PutPushSubscriptionRequest
} from '@nihongo/contracts/notification/web-push'
import { pushConfigResponseSchema, pushNoContentSchema } from '@api/push/schema'

const read = safeGet(pushConfigResponseSchema)
const write = safePut(pushNoContentSchema)
const remove = safeDel(pushNoContentSchema)
// #1046: the daily goal push. PUT is members only; DELETE needs no sign-in,
// so logout can call it.
export const getPushConfig = () => read('/v1/push/config')
export const putPushSubscription = (body: PutPushSubscriptionRequest) =>
  write('/v1/push/subscription', body)
export const deletePushSubscription = (body: DeletePushSubscriptionRequest) =>
  remove('/v1/push/subscription', undefined, { data: body })
