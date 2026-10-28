import { describe, expect, it } from 'vitest'
import { Phase7RateLimitRepository } from '@mocks/repository/phase7RateLimitRepository'

const actorId = '019d0000-0000-7000-8000-000000000001'

describe('report rate limit fixture', () => {
  it('accepts legacy administrator buckets and keeps report 429 behavior', async () => {
    let stored: string | null = JSON.stringify({
      schemaVersion: 1,
      windows: [
        [`ADMIN_EDIT:actor:${actorId}`, { count: 1, windowStartedAt: 1000 }]
      ]
    })
    const repository = new Phase7RateLimitRepository({
      lease: async (operation) => await operation(),
      now: () => 1000,
      storage: {
        getItem: () => stored,
        removeItem: () => {
          stored = null
        },
        setItem: (_key, value) => {
          stored = value
        }
      }
    })
    const input = { group: 'REPORT_ACTOR', actorId } as const

    for (let count = 0; count < 5; count += 1) {
      await expect(repository.consume(input)).resolves.toEqual({
        retryAfterSeconds: null
      })
    }
    await expect(repository.consume(input)).resolves.toEqual({
      retryAfterSeconds: 600
    })
    expect(stored).toContain(`ADMIN_EDIT:actor:${actorId}`)
  })
})
