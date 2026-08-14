import { describe, expect, it } from 'vitest'
import {
  assertSafeDevelopmentDatabase,
  assertSafeTestDatabase
} from './databaseTargetGuard.js'

const testUrl = 'postgresql://nihongo:secret@127.0.0.1:55432/nihongo_test'
const developmentUrl = 'postgresql://nihongo:secret@127.0.0.1:55432/nihongo_dev'

describe('database target guard', () => {
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
