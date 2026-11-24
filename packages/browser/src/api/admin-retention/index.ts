import { getAdminRetentionResponseSchema } from '@nihongo/contracts/admin/retention'
import { safeGet } from '../http'

const requestRetention = safeGet(getAdminRetentionResponseSchema)

/** #1266: the daily return counts of the last 8 weeks. */
export const getAdminRetention = () => requestRetention('/v1/admin/retention')
