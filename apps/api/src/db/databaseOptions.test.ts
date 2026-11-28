import { describe, expect, it } from 'vitest'
import { toNodePostgresConnectionString } from './databaseOptions.js'

const base = 'postgresql://login:unit-only@postgres:5432/nihongo'

describe('toNodePostgresConnectionString (#1355)', () => {
  it.each(['require', 'REQUIRE', 'verify-ca', 'prefer'])(
    'pins sslmode=%s to the verify-full check pg 8 already does',
    (mode) => {
      expect(
        toNodePostgresConnectionString(`${base}?schema=public&sslmode=${mode}`)
      ).toBe(`${base}?schema=public&sslmode=verify-full`)
    }
  )

  it('keeps every other parameter exactly as written', () => {
    expect(
      toNodePostgresConnectionString(
        `${base}?sslmode=require&schema=public&options=-c%20role%3Dnihongo_migration`
      )
    ).toBe(
      `${base}?sslmode=verify-full&schema=public&options=-c%20role%3Dnihongo_migration`
    )
  })

  it.each([
    `${base}?schema=public`,
    `${base}?schema=public&sslmode=verify-full`,
    `${base}?schema=public&sslmode=disable`,
    `${base}?schema=public&sslmode=required`,
    `${base}?application_name=sslmode=require`
  ])('leaves %s unchanged', (url) => {
    expect(toNodePostgresConnectionString(url)).toBe(url)
  })
})
