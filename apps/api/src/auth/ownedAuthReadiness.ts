import type { PrismaClient } from '../generated/prisma/client.js'
import { attestRuntimeRoles } from '../db/runtimeRoleAttestation.js'
/** Uses the same database/role proof in CMS-enabled and CMS-disabled runtimes. */
export const createOwnedAuthReadiness =
  ({
    checkDatabaseReadiness,
    applicationClient,
    applicationUrl,
    attest = attestRuntimeRoles
  }: {
    checkDatabaseReadiness: () => Promise<void>
    applicationClient: Pick<PrismaClient, '$queryRawUnsafe'>
    applicationUrl: string
    attest?: typeof attestRuntimeRoles
  }) =>
  async (): Promise<void> => {
    await checkDatabaseReadiness()
    await attest({
      application: {
        client: applicationClient,
        connectionString: applicationUrl,
        expectedRole: 'nihongo_app'
      }
    })
    await applicationClient.$queryRawUnsafe(
      'SELECT "require_runtime_ready"()'
    )
  }
