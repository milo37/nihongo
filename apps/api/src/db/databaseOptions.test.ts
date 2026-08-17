import { describe, expect, it } from 'vitest'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from './databaseOptions.js'

describe('getPostgresSchema', () => {
  it('schema query를 Prisma adapter option으로 추출한다', () => {
    expect(
      getPostgresSchema(
        'postgresql://user:password@127.0.0.1:5432/database?schema=test_schema'
      )
    ).toBe('test_schema')
  })

  it('schema가 없으면 기본 PostgreSQL search path를 사용한다', () => {
    expect(
      getPostgresSchema('postgresql://user:password@127.0.0.1:5432/database')
    ).toBeUndefined()
  })

  it.each([
    'schema=first&schema=second',
    'schema=MixedCase',
    'schema=public%3Bdrop',
    'schema=123invalid'
  ])('모호하거나 안전하지 않은 %s를 거부한다', (query) => {
    expect(() =>
      getPostgresSchema(
        `postgresql://user:password@127.0.0.1:5432/database?${query}`
      )
    ).toThrow('PostgreSQL schema must be one safe identifier.')
  })
})

describe('createPostgresStartupOptions', () => {
  it('schema 유무와 무관하게 UTC를 강제하고 safe search_path를 보존한다', () => {
    expect(createPostgresStartupOptions('test_schema')).toBe(
      '-c search_path=test_schema -c TimeZone=UTC'
    )
    expect(createPostgresStartupOptions(undefined)).toBe('-c TimeZone=UTC')
  })
})
