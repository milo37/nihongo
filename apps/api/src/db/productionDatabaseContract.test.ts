import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import { parseApiEnvironment } from '../config/env.js'
import { assertSafeMigrationDatabase } from './databaseTargetGuard.js'
import {
  attestRuntimeRoles,
  type RuntimeRoleEvidence
} from './runtimeRoleAttestation.js'

// Shared with the infra provisioning: DB nihongo and nihongo_production_*_login.
const runtimeUrl =
  'postgresql://nihongo_production_app_login:unit-only@postgres:5432/nihongo?schema=public&sslmode=require'
const migrationUrl =
  'postgresql://nihongo_production_migration_login:unit-only@postgres:5432/nihongo?schema=public&sslmode=require&options=-c%20role%3Dnihongo_migration'
const change = (value: string, edit: (url: URL) => void): string => {
  const url = new URL(value)
  edit(url)
  return url.href
}

describe('production migration target (B1)', () => {
  const migration =
    (input: {
      migrationDatabaseUrl?: string
      runtimeDatabaseUrl?: string
      productionDatabaseUrl?: string
    }) =>
    () =>
      assertSafeMigrationDatabase({
        nodeEnvironment: 'production',
        migrationDatabaseUrl: migrationUrl,
        runtimeDatabaseUrl: runtimeUrl,
        productionDatabaseUrl: runtimeUrl,
        ...input
      })

  it('accepts the production migration login on the proven production database', () => {
    expect(migration({})).not.toThrow()
  })

  it.each<[string, Parameters<typeof migration>[0]]>([
    [
      'a test migration login',
      {
        migrationDatabaseUrl: change(migrationUrl, (url) => {
          url.username = 'nihongo_test_migration_login'
        })
      }
    ],
    [
      'the production app login',
      {
        migrationDatabaseUrl: change(migrationUrl, (url) => {
          url.username = 'nihongo_production_app_login'
        })
      }
    ],
    [
      'another database name',
      {
        migrationDatabaseUrl: change(migrationUrl, (url) => {
          url.pathname = '/nihongo_prod'
        }),
        runtimeDatabaseUrl: change(runtimeUrl, (url) => {
          url.pathname = '/nihongo_prod'
        }),
        productionDatabaseUrl: change(runtimeUrl, (url) => {
          url.pathname = '/nihongo_prod'
        })
      }
    ],
    [
      'a missing sslmode',
      {
        migrationDatabaseUrl: change(migrationUrl, (url) => {
          url.searchParams.delete('sslmode')
        })
      }
    ],
    [
      'a weaker sslmode',
      {
        migrationDatabaseUrl: change(migrationUrl, (url) => {
          url.searchParams.set('sslmode', 'prefer')
        })
      }
    ],
    [
      'a database other than PRODUCTION_DATABASE_URL',
      {
        productionDatabaseUrl: change(runtimeUrl, (url) => {
          url.hostname = 'other.invalid'
        })
      }
    ],
    [
      'a schema other than PRODUCTION_DATABASE_URL',
      {
        productionDatabaseUrl: change(runtimeUrl, (url) => {
          url.searchParams.set('schema', 'other')
        })
      }
    ],
    [
      'a missing startup role',
      {
        migrationDatabaseUrl: change(migrationUrl, (url) => {
          url.searchParams.delete('options')
        })
      }
    ],
    [
      'a runtime on another database',
      {
        runtimeDatabaseUrl: change(runtimeUrl, (url) => {
          url.hostname = 'other.invalid'
        })
      }
    ]
  ])('rejects %s', (_label, input) => {
    expect(migration(input)).toThrow()
  })

  it('still rejects an unknown NODE_ENV', () => {
    expect(() =>
      assertSafeMigrationDatabase({
        nodeEnvironment: 'staging',
        migrationDatabaseUrl: migrationUrl,
        runtimeDatabaseUrl: runtimeUrl,
        productionDatabaseUrl: runtimeUrl
      })
    ).toThrow('Migration requires NODE_ENV=test, development or production.')
  })
})

describe('production runtime login contract (B2)', () => {
  const origin = 'https://app.example.test'
  const production = (databaseUrl: string) => () =>
    parseApiEnvironment({
      NODE_ENV: 'production',
      DEPLOYMENT_ENVIRONMENT: 'PRODUCTION',
      RELEASE_ID: 'a'.repeat(40),
      HOST: '127.0.0.1',
      PORT: '3001',
      LOG_LEVEL: 'error',
      DATABASE_URL: databaseUrl,
      TRUSTED_ORIGINS: origin,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
      GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890',
      AUTH_EMAIL_FROM: 'placeholder@example.test',
      AUTH_EMAIL_DELIVERY_MODE: 'webhook',
      AUTH_EMAIL_WEBHOOK_URL: 'https://mail.example.test',
      AUTH_EMAIL_WEBHOOK_SECRET: 'test-webhook-placeholder-only-1234567890',
      AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32'
    })

  it('accepts the production app login on nihongo', () => {
    expect(production(runtimeUrl)).not.toThrow()
  })

  it.each([
    [
      'the production migration login',
      change(runtimeUrl, (url) => {
        url.username = 'nihongo_production_migration_login'
      })
    ],
    [
      'a bootstrap superuser',
      change(runtimeUrl, (url) => {
        url.username = 'postgres'
      })
    ],
    [
      'another database name',
      change(runtimeUrl, (url) => {
        url.pathname = '/nihongo_prod'
      })
    ],
    [
      'a missing sslmode',
      change(runtimeUrl, (url) => {
        url.searchParams.delete('sslmode')
      })
    ],
    [
      'a missing schema',
      change(runtimeUrl, (url) => {
        url.searchParams.delete('schema')
      })
    ]
  ])('rejects %s', (_label, databaseUrl) => {
    expect(production(databaseUrl)).toThrow()
  })
})

describe('production runtime role attestation (B2)', () => {
  const evidence = (
    change: Partial<RuntimeRoleEvidence> = {}
  ): RuntimeRoleEvidence => ({
    currentDatabase: 'nihongo',
    currentDatabaseExpectedWrapperConnectAclCount: 2,
    currentDatabaseUnexpectedAclCount: 0,
    currentRole: 'nihongo_app',
    currentSchema: 'public',
    directGrants: ['nihongo_app'],
    groupBypassRls: false,
    groupCanLogin: false,
    groupCanControlReplicationRole: false,
    groupCreateDb: false,
    groupCreateRole: false,
    groupDirectGrants: [],
    groupInherit: false,
    groupSensitiveColumnAclCount: 0,
    groupSensitiveTableAclCount: 0,
    groupReplication: false,
    groupSuperuser: false,
    databaseOwner: 'nihongo_migration',
    serverAddress: null,
    serverPort: null,
    schemaOwner: 'nihongo_owner',
    sessionReplicationRole: 'origin',
    sessionUser: 'nihongo_production_app_login',
    sessionUserBypassRls: false,
    sessionUserCanLogin: true,
    sessionUserCanControlReplicationRole: false,
    sessionUserColumnAclCount: 0,
    sessionUserCreateDb: false,
    sessionUserCreateRole: false,
    sessionUserCurrentDatabaseConnectAclCount: 1,
    sessionUserInherit: false,
    sessionUserMembershipAdminOption: false,
    sessionUserMembershipInheritOption: false,
    sessionUserMembershipSetOption: true,
    sessionUserOtherDirectAclCount: 0,
    sessionUserReplication: false,
    sessionUserSuperuser: false,
    sessionUserCanSetRole: true,
    timeZone: 'UTC',
    ...change
  })
  const attest = (row: RuntimeRoleEvidence, connectionString = runtimeUrl) =>
    attestRuntimeRoles({
      application: {
        client: {
          $queryRawUnsafe: (async () => [
            row
          ]) as unknown as PrismaClient['$queryRawUnsafe']
        },
        connectionString,
        expectedRole: 'nihongo_app'
      }
    })

  it('accepts the production app login on nihongo', async () => {
    await expect(attest(evidence())).resolves.toBeUndefined()
  })

  it('rejects a production session that is not the production app login', async () => {
    await expect(
      attest(evidence({ sessionUser: 'nihongo_test_app_login' }))
    ).rejects.toThrow('Runtime DB role attestation failed.')
  })

  it('rejects a database name outside the shared contract', async () => {
    await expect(
      attest(
        evidence({ currentDatabase: 'nihongo_prod' }),
        change(runtimeUrl, (url) => {
          url.pathname = '/nihongo_prod'
        })
      )
    ).rejects.toThrow('Runtime DB role attestation failed.')
  })

  it('rejects production without the expected wrapper CONNECT grants', async () => {
    await expect(
      attest(evidence({ currentDatabaseExpectedWrapperConnectAclCount: 0 }))
    ).rejects.toThrow('Runtime DB role attestation failed.')
  })
})
