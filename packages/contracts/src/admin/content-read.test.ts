import { describe, expect, it } from 'vitest'
import {
  adminAuditEnvironmentSchema,
  listAdminAuditLogQuerySchema
} from './content-read.js'

describe('Phase 7 admin read transport', () => {
  it('accepts the canonical production audit environment', () => {
    expect(adminAuditEnvironmentSchema.options).toEqual([
      'TEST',
      'DEVELOPMENT',
      'PRODUCTION'
    ])
    expect(
      listAdminAuditLogQuerySchema.parse({ environment: 'PRODUCTION' })
    ).toEqual({ environment: 'PRODUCTION', limit: 20 })
  })
})
