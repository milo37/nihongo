import type { PrismaClient } from '../generated/prisma/client.js'
import { attestPhase7RuntimeRoles } from '../db/phase7RuntimeRoleAttestation.js'
/** Uses the same database/role proof in CMS-enabled and CMS-disabled runtimes. */
export const createOwnedAuthReadiness =
  ({
    checkDatabaseReadiness,
    applicationClient,
    gatewayClient,
    applicationUrl,
    gatewayUrl,
    attest = attestPhase7RuntimeRoles
  }: {
    checkDatabaseReadiness: () => Promise<void>
    applicationClient: Pick<PrismaClient, '$queryRawUnsafe'>
    gatewayClient: Pick<PrismaClient, '$queryRawUnsafe'>
    applicationUrl: string
    gatewayUrl: string
    attest?: typeof attestPhase7RuntimeRoles
  }) =>
  async (): Promise<void> => {
    await checkDatabaseReadiness()
    await attest({
      application: {
        client: applicationClient,
        connectionString: applicationUrl,
        expectedRole: 'nihongo_app'
      },
      authGateway: {
        client: gatewayClient,
        connectionString: gatewayUrl,
        expectedRole: 'nihongo_auth_gateway'
      }
    })
    await Promise.all([
      applicationClient.$queryRawUnsafe(
        'SELECT "phase7_require_runtime_ready"()'
      ),
      gatewayClient.$queryRawUnsafe('SELECT "phase7_require_runtime_ready"()')
    ])
  }
