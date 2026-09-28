import { describe, expect, it } from 'vitest'
import { phase7AdminQueries } from '@app/admin-question/queries/phase7AdminQueries'

describe('Phase 7 admin query factories', () => {
  it('creates the refined audit-log connection without deriving an invalid omit schema', () => {
    expect(() =>
      phase7AdminQueries.auditLogConnection({ limit: 50 })
    ).not.toThrow()
  })
})
