import { describe, expect, it } from 'vitest'
import {
  assertSafeAdminCmsDatabase,
  assertSafeDevelopmentDatabase,
  assertSafePhase7MigrationDatabase,
  assertSafeTestDatabase
} from './databaseTargetGuard.js'

const testUrl = 'postgresql://nihongo:secret@127.0.0.1:55432/nihongo_test'
const developmentUrl = 'postgresql://nihongo:secret@127.0.0.1:55432/nihongo_dev'
const productionUrl =
  'postgresql://nihongo:secret@production.example.com:5432/nihongo'
const testRuntimeUrl =
  'postgresql://nihongo_test_app_login:secret@127.0.0.1:55432/nihongo_test?schema=phase7_test'
const testMigrationUrl =
  'postgresql://nihongo_test_phase7_migration_login:secret@127.0.0.1:55432/nihongo_test?schema=phase7_test&options=-c%20role%3Dnihongo_phase7_migration'
const developmentRuntimeUrl =
  'postgresql://nihongo_development_app_login:secret@localhost:55432/nihongo_dev?schema=phase7_dev'
const developmentMigrationUrl =
  'postgresql://nihongo_development_phase7_migration_login:secret@localhost:55432/nihongo_dev?schema=phase7_dev&options=-c%20role%3Dnihongo_phase7_migration'

describe('database target guard', () => {
  it('Phase 7 migration은 전용 canonical wrapper와 동일 runtime target만 허용한다', () => {
    expect(() =>
      assertSafePhase7MigrationDatabase({
        nodeEnvironment: 'test',
        migrationDatabaseUrl: testMigrationUrl,
        runtimeDatabaseUrl: testRuntimeUrl,
        productionDatabaseUrl: productionUrl
      })
    ).not.toThrow()
    expect(() =>
      assertSafePhase7MigrationDatabase({
        nodeEnvironment: 'development',
        migrationDatabaseUrl: developmentMigrationUrl,
        runtimeDatabaseUrl: developmentRuntimeUrl,
        productionDatabaseUrl: productionUrl
      })
    ).not.toThrow()
  })

  it.each([
    {
      label: 'missing migration URL',
      migrationDatabaseUrl: undefined,
      runtimeDatabaseUrl: testRuntimeUrl,
      productionDatabaseUrl: productionUrl
    },
    {
      label: 'missing runtime URL',
      migrationDatabaseUrl: testMigrationUrl,
      runtimeDatabaseUrl: undefined,
      productionDatabaseUrl: productionUrl
    },
    {
      label: 'missing production proof',
      migrationDatabaseUrl: testMigrationUrl,
      runtimeDatabaseUrl: testRuntimeUrl,
      productionDatabaseUrl: undefined
    },
    {
      label: 'runtime app URL injected as migration URL',
      migrationDatabaseUrl: testRuntimeUrl,
      runtimeDatabaseUrl: testRuntimeUrl,
      productionDatabaseUrl: productionUrl
    },
    {
      label: 'admin URL injected as migration URL',
      migrationDatabaseUrl:
        'postgresql://nihongo:secret@127.0.0.1:55432/nihongo_test?schema=phase7_test&options=-c%20role%3Dnihongo_phase7_migration',
      runtimeDatabaseUrl: testRuntimeUrl,
      productionDatabaseUrl: productionUrl
    },
    {
      label: 'missing startup role',
      migrationDatabaseUrl:
        'postgresql://nihongo_test_phase7_migration_login:secret@127.0.0.1:55432/nihongo_test?schema=phase7_test',
      runtimeDatabaseUrl: testRuntimeUrl,
      productionDatabaseUrl: productionUrl
    },
    {
      label: 'duplicate startup role',
      migrationDatabaseUrl: `${testMigrationUrl}&options=-c%20role%3Dnihongo_phase7_migration`,
      runtimeDatabaseUrl: testRuntimeUrl,
      productionDatabaseUrl: productionUrl
    },
    {
      label: 'extra startup option',
      migrationDatabaseUrl:
        'postgresql://nihongo_test_phase7_migration_login:secret@127.0.0.1:55432/nihongo_test?schema=phase7_test&options=-c%20role%3Dnihongo_phase7_migration%20-c%20search_path%3Dpublic',
      runtimeDatabaseUrl: testRuntimeUrl,
      productionDatabaseUrl: productionUrl
    },
    {
      label: 'different schema',
      migrationDatabaseUrl: testMigrationUrl,
      runtimeDatabaseUrl: testRuntimeUrl.replace('phase7_test', 'other_schema'),
      productionDatabaseUrl: productionUrl
    },
    {
      label: 'different port',
      migrationDatabaseUrl: testMigrationUrl,
      runtimeDatabaseUrl: testRuntimeUrl.replace('55432', '55433'),
      productionDatabaseUrl: productionUrl
    },
    {
      label: 'production database name alias',
      migrationDatabaseUrl: testMigrationUrl,
      runtimeDatabaseUrl: testRuntimeUrl,
      productionDatabaseUrl:
        'postgresql://production:secret@production.example.com/nihongo_test'
    }
  ])('Phase 7 migration은 $label을 첫 write 전에 거부한다', (input) => {
    expect(() =>
      assertSafePhase7MigrationDatabase({
        nodeEnvironment: 'test',
        ...input
      })
    ).toThrow()
  })

  it('production disabled는 닫힌 route로 유지하고 technical만 격리 DB를 요구한다', () => {
    expect(() =>
      assertSafeAdminCmsDatabase({
        adminCmsMode: 'disabled',
        nodeEnvironment: 'production',
        databaseUrl: 'postgresql://user:secret@db.example.com/nihongo'
      })
    ).not.toThrow()
    expect(() =>
      assertSafeAdminCmsDatabase({
        adminCmsMode: 'technical',
        nodeEnvironment: 'test',
        databaseUrl: testUrl,
        productionDatabaseUrl: productionUrl
      })
    ).not.toThrow()
    expect(() =>
      assertSafeAdminCmsDatabase({
        adminCmsMode: 'technical',
        nodeEnvironment: 'development',
        databaseUrl: developmentUrl,
        productionDatabaseUrl: productionUrl
      })
    ).not.toThrow()

    for (const input of [
      {
        adminCmsMode: 'technical' as const,
        nodeEnvironment: 'production',
        databaseUrl: testUrl
      },
      {
        adminCmsMode: 'technical' as const,
        nodeEnvironment: 'test',
        databaseUrl: developmentUrl,
        productionDatabaseUrl: productionUrl
      },
      {
        adminCmsMode: 'technical' as const,
        nodeEnvironment: 'development',
        databaseUrl: 'postgresql://user:secret@db.example.com/nihongo_dev',
        productionDatabaseUrl: productionUrl
      }
    ]) {
      expect(() => assertSafeAdminCmsDatabase(input)).toThrow()
    }
  })

  it('test/development disabled server는 exact legacy wrapper와 환경 DB만 허용한다', () => {
    expect(() =>
      assertSafeAdminCmsDatabase({
        adminCmsMode: 'disabled',
        nodeEnvironment: 'test',
        databaseUrl:
          'postgresql://nihongo_test_legacy_app_login:secret@127.0.0.1:55432/nihongo_test'
      })
    ).not.toThrow()
    expect(() =>
      assertSafeAdminCmsDatabase({
        adminCmsMode: 'disabled',
        nodeEnvironment: 'development',
        databaseUrl:
          'postgresql://nihongo_development_legacy_app_login:secret@127.0.0.1:55432/nihongo_dev'
      })
    ).not.toThrow()

    for (const input of [
      {
        adminCmsMode: 'disabled' as const,
        nodeEnvironment: 'test',
        databaseUrl: testUrl
      },
      {
        adminCmsMode: 'disabled' as const,
        nodeEnvironment: 'test',
        databaseUrl:
          'postgresql://nihongo_test_legacy_app_login:secret@127.0.0.1:55432/nihongo_dev'
      },
      {
        adminCmsMode: 'disabled' as const,
        nodeEnvironment: 'development',
        databaseUrl:
          'postgresql://nihongo_development_legacy_app_login:secret@127.0.0.1:55432/nihongo'
      },
      {
        adminCmsMode: 'disabled' as const,
        nodeEnvironment: 'test',
        databaseUrl:
          'postgresql://nihongo_test_legacy_app_login:secret@database.example.com:55432/nihongo_test'
      },
      {
        adminCmsMode: 'disabled' as const,
        nodeEnvironment: 'test',
        databaseUrl:
          'postgresql://nihongo_test_legacy_app_login:secret@127.0.0.1:55432/nihongo_test',
        productionDatabaseUrl:
          'postgresql://production:secret@production.example.com/nihongo_test'
      }
    ]) {
      expect(() => assertSafeAdminCmsDatabase(input)).toThrow()
    }
  })

  it('technical CMS는 production proof 누락과 endpoint alias를 fail closed한다', () => {
    expect(() =>
      assertSafeAdminCmsDatabase({
        adminCmsMode: 'technical',
        nodeEnvironment: 'test',
        databaseUrl: testUrl
      })
    ).toThrow(/PRODUCTION_DATABASE_URL/u)

    for (const productionDatabaseUrl of [
      'postgresql://other:secret@localhost:5432/nihongo_test',
      'postgresql://other:secret@[::1]:6543/nihongo_test',
      'postgresql://other:secret@postgres:5432/nihongo_test'
    ]) {
      expect(() =>
        assertSafeAdminCmsDatabase({
          adminCmsMode: 'technical',
          nodeEnvironment: 'test',
          databaseUrl: testUrl,
          productionDatabaseUrl
        })
      ).toThrow(/must not target one DB/u)
    }
  })

  it('NODE_ENV=test와 격리된 loopback _test DB만 허용한다', () => {
    expect(() =>
      assertSafeTestDatabase({
        nodeEnvironment: 'test',
        databaseUrl: testUrl,
        productionDatabaseUrl: developmentUrl
      })
    ).not.toThrow()

    for (const input of [
      { nodeEnvironment: 'production', databaseUrl: testUrl },
      {
        nodeEnvironment: 'test',
        databaseUrl: 'postgresql://user:secret@db.example.com/nihongo_test'
      },
      { nodeEnvironment: 'test', databaseUrl: developmentUrl },
      {
        nodeEnvironment: 'test',
        databaseUrl: testUrl,
        productionDatabaseUrl:
          'postgresql://other:credential@127.0.0.1:55432/nihongo_test'
      }
    ]) {
      expect(() => assertSafeTestDatabase(input)).toThrow()
    }
  })

  it('migrate dev는 development 환경의 loopback _dev DB만 허용한다', () => {
    expect(() =>
      assertSafeDevelopmentDatabase({
        nodeEnvironment: 'development',
        databaseUrl: developmentUrl
      })
    ).not.toThrow()
    expect(() =>
      assertSafeDevelopmentDatabase({
        nodeEnvironment: 'production',
        databaseUrl: developmentUrl
      })
    ).toThrow()
    expect(() =>
      assertSafeDevelopmentDatabase({
        nodeEnvironment: 'development',
        databaseUrl: 'postgresql://user:secret@db.example.com/nihongo_dev'
      })
    ).toThrow()
  })
})
