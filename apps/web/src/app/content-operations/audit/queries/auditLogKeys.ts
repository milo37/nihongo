import type { ListAdminAuditLogQuery } from '@nihongo/contracts/admin/phase7'

const rootKey = ['phase7-admin'] as const

export const adminAuditLogKeys = {
  all: () => [...rootKey, 'audit-log'] as const,
  allLists: () => [...adminAuditLogKeys.all(), 'list'] as const,
  list: (query: ListAdminAuditLogQuery) =>
    [...adminAuditLogKeys.allLists(), query] as const
} as const
