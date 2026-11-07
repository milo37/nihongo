import type { AdminReauthenticationResult } from '@nihongo/contracts/admin/content-operations'
import { ApplicationError } from '../errors/applicationError.js'
interface AdminReauthenticationInput {
  readonly actorId: string
  readonly headers: Headers
  readonly password: string
  readonly rawSessionToken: string
  readonly requestId: string
}

interface AdminReauthenticationOutput {
  readonly response: AdminReauthenticationResult
  readonly setCookies: readonly string[]
}

export interface AdminReauthenticationService {
  reauthenticate: (
    input: AdminReauthenticationInput
  ) => Promise<AdminReauthenticationOutput>
}

/** Retired compatibility surface; never verifies passwords or writes auth data. */
export const createAdminReauthenticationService =
  (): AdminReauthenticationService => ({
    reauthenticate: async () => {
      throw new ApplicationError({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Retired authentication operation.',
        retryable: false,
        adminDisposition: 'NO_TX'
      })
    }
  })
