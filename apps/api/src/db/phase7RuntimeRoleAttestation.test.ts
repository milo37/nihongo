import { describe, expect, it } from 'vitest'
import {
  assertPhase7RuntimeRoleEvidence,
  type RuntimeRoleEvidence
} from './phase7RuntimeRoleAttestation.js'

const evidence = (
  sessionUser: string,
  currentRole: 'nihongo_app' | 'nihongo_auth_gateway'
): RuntimeRoleEvidence => ({
  currentDatabase: 'nihongo_test',
  currentDatabaseExpectedWrapperConnectAclCount: 4,
  currentDatabaseUnexpectedAclCount: 0,
  currentRole,
  currentSchema: 'phase7_test',
  databaseOwner: 'nihongo_phase7_migration',
  directGrants: [currentRole],
  groupBypassRls: false,
  groupCanLogin: false,
  groupCanControlReplicationRole: false,
  groupCreateDb: false,
  groupCreateRole: false,
  groupDirectGrants: [],
  groupInherit: false,
  groupReplication: false,
  groupSuperuser: false,
  serverAddress: '127.0.0.1',
  serverPort: 55432,
  schemaOwner: 'nihongo_phase7_owner',
  sessionReplicationRole: 'origin',
  sessionUser,
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
  timeZone: 'UTC'
})

const endpoints = {
  application: {
    connectionString:
      'postgresql://nihongo_test_app_login:secret@127.0.0.1:55432/nihongo_test?schema=phase7_test',
    expectedRole: 'nihongo_app' as const
  },
  authGateway: {
    connectionString:
      'postgresql://nihongo_test_auth_gateway_login:secret@127.0.0.1:55432/nihongo_test?schema=phase7_test',
    expectedRole: 'nihongo_auth_gateway' as const
  }
}

describe('Phase 7 runtime role attestation', () => {
  it('서로 다른 wrapper login이 정확한 NOLOGIN role로 전환된 동일 target만 허용한다', () => {
    expect(() =>
      assertPhase7RuntimeRoleEvidence(
        evidence('nihongo_test_app_login', 'nihongo_app'),
        evidence('nihongo_test_auth_gateway_login', 'nihongo_auth_gateway'),
        endpoints
      )
    ).not.toThrow()
  })

  it('development DB는 development 전용 exact wrapper 이름만 허용한다', () => {
    const application = {
      ...evidence('nihongo_development_app_login', 'nihongo_app'),
      currentDatabase: 'nihongo_dev',
      currentSchema: 'phase7_dev'
    }
    const authGateway = {
      ...evidence(
        'nihongo_development_auth_gateway_login',
        'nihongo_auth_gateway'
      ),
      currentDatabase: 'nihongo_dev',
      currentSchema: 'phase7_dev'
    }
    expect(() =>
      assertPhase7RuntimeRoleEvidence(application, authGateway, {
        application: {
          connectionString:
            'postgresql://nihongo_development_app_login:secret@127.0.0.1:55432/nihongo_dev?schema=phase7_dev',
          expectedRole: 'nihongo_app'
        },
        authGateway: {
          connectionString:
            'postgresql://nihongo_development_auth_gateway_login:secret@127.0.0.1:55432/nihongo_dev?schema=phase7_dev',
          expectedRole: 'nihongo_auth_gateway'
        }
      })
    ).not.toThrow()
  })

  it('DB suffix와 무관한 임의 wrapper naming을 거부한다', () => {
    expect(() =>
      assertPhase7RuntimeRoleEvidence(
        evidence('app_wrapper', 'nihongo_app'),
        evidence('auth_wrapper', 'nihongo_auth_gateway'),
        {
          application: {
            ...endpoints.application,
            connectionString:
              'postgresql://app_wrapper:secret@127.0.0.1:55432/nihongo_test?schema=phase7_test'
          },
          authGateway: {
            ...endpoints.authGateway,
            connectionString:
              'postgresql://auth_wrapper:secret@127.0.0.1:55432/nihongo_test?schema=phase7_test'
          }
        }
      )
    ).toThrow('Phase 7 runtime DB role attestation failed.')
  })

  it.each([
    ['wrong current role', { currentRole: 'nihongo_auth_gateway' }],
    ['login role mismatch', { sessionUser: 'other_wrapper' }],
    ['group login enabled', { groupCanLogin: true }],
    [
      'group replication parameter privilege',
      { groupCanControlReplicationRole: true }
    ],
    ['group superuser', { groupSuperuser: true }],
    ['SET ROLE unavailable', { sessionUserCanSetRole: false }],
    ['non-UTC session', { timeZone: 'Asia/Tokyo' }],
    ['replica session', { sessionReplicationRole: 'replica' }],
    ['wrapper superuser', { sessionUserSuperuser: true }],
    [
      'wrapper replication parameter privilege',
      { sessionUserCanControlReplicationRole: true }
    ],
    [
      'wrapper membership admin option',
      { sessionUserMembershipAdminOption: true }
    ],
    [
      'wrapper membership inherit option',
      { sessionUserMembershipInheritOption: true }
    ],
    [
      'wrapper membership SET option missing',
      { sessionUserMembershipSetOption: false }
    ],
    ['wrapper database owner', { databaseOwner: 'nihongo_test_app_login' }],
    ['unrelated database owner', { databaseOwner: 'postgres' }],
    ['schema owner mismatch', { schemaOwner: 'nihongo_test_app_login' }],
    [
      'missing current database CONNECT ACL',
      { sessionUserCurrentDatabaseConnectAclCount: 0 }
    ],
    [
      'duplicate current database CONNECT ACL evidence',
      { sessionUserCurrentDatabaseConnectAclCount: 2 }
    ],
    [
      'missing expected wrapper CONNECT ACL',
      { currentDatabaseExpectedWrapperConnectAclCount: 3 }
    ],
    [
      'PUBLIC/cross-environment/grantable database ACL',
      { currentDatabaseUnexpectedAclCount: 1 }
    ],
    ['wrapper direct column ACL', { sessionUserColumnAclCount: 1 }],
    ['wrapper other direct ACL', { sessionUserOtherDirectAclCount: 1 }],
    ['extra membership', { directGrants: ['nihongo_app', 'pg_read_all_data'] }]
  ])('%s를 fail closed한다', (_label, change) => {
    expect(() =>
      assertPhase7RuntimeRoleEvidence(
        { ...evidence('nihongo_test_app_login', 'nihongo_app'), ...change },
        evidence('nihongo_test_auth_gateway_login', 'nihongo_auth_gateway'),
        endpoints
      )
    ).toThrow('Phase 7 runtime DB role attestation failed.')
  })

  it('database/schema/server/wrapper 분리가 다르면 거부한다', () => {
    expect(() =>
      assertPhase7RuntimeRoleEvidence(
        evidence('nihongo_test_app_login', 'nihongo_app'),
        {
          ...evidence(
            'nihongo_test_auth_gateway_login',
            'nihongo_auth_gateway'
          ),
          serverAddress: '127.0.0.2'
        },
        endpoints
      )
    ).toThrow('Phase 7 runtime DB endpoints do not share one safe target.')
  })

  it('실제 server address/port를 증명할 수 없는 연결을 거부한다', () => {
    expect(() =>
      assertPhase7RuntimeRoleEvidence(
        {
          ...evidence('nihongo_test_app_login', 'nihongo_app'),
          serverAddress: null,
          serverPort: null
        },
        {
          ...evidence(
            'nihongo_test_auth_gateway_login',
            'nihongo_auth_gateway'
          ),
          serverAddress: null,
          serverPort: null
        },
        endpoints
      )
    ).toThrow('Phase 7 runtime DB endpoints do not share one safe target.')
  })
})
