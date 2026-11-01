import type { AdminReauthenticationResult } from '@nihongo/contracts/admin/content-operations'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Phase7ReauthenticationAuthApi } from '../auth/createReauthenticationAuth.js'
import type { Phase7ReauthenticationContext } from '../auth/reauthenticationContext.js'
import { ApplicationError } from '../errors/applicationError.js'
export interface AdminReauthenticationInput {
  readonly actorId: string
  readonly headers: Headers
  readonly password: string
  readonly rawSessionToken: string
  readonly requestId: string
}

export interface AdminReauthenticationOutput {
  readonly response: AdminReauthenticationResult
  readonly setCookies: readonly string[]
}

export interface AdminReauthenticationService {
  reauthenticate: (
    input: AdminReauthenticationInput
  ) => Promise<AdminReauthenticationOutput>
}

/** Retired compatibility surface; never verifies passwords or writes auth data. */
export const createAdminReauthenticationService = (_dependencies: {
  auditEnvironment: 'TEST' | 'DEVELOPMENT'
  authApi: Phase7ReauthenticationAuthApi
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  context: Phase7ReauthenticationContext
  createIntentId?: () => string
}): AdminReauthenticationService => ({
  reauthenticate: async () => {
    throw new ApplicationError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Retired authentication operation.',
      retryable: false,
      phase7Disposition: 'NO_TX'
    })
  }
})
