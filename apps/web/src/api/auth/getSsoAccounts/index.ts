import { safeGet } from '@api/http'
import { getSsoAccountsResponseSchema } from '@api/auth/getSsoAccounts/schema'
const request = safeGet(getSsoAccountsResponseSchema)
export const getSsoAccounts = () => request('/auth/sso/accounts')
