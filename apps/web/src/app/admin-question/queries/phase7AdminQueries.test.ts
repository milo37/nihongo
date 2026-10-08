import {
  encodePhase7OccurredAtCursor,
  type ListAdminAuditLogQuery
} from '@nihongo/contracts/admin/phase7'
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import * as phase7AdminApi from '@api/phase7/phase7AdminApi'
import { phase7AdminQueries } from '@app/admin-question/queries/phase7AdminQueries'

describe('Phase 7 admin query factories', () => {
  it('creates the refined audit-log connection without deriving an invalid omit schema', () => {
    expect(() =>
      phase7AdminQueries.auditLogConnection({ limit: 50 })
    ).not.toThrow()
  })
})

const createAuditQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('audit-log query cache and transport behavior', () => {
  it('retains parsed filters for the list cache and request after caller input changes', async () => {
    const response = { items: [], nextCursor: null }
    const request = vi
      .spyOn(phase7AdminApi, 'listPhase7AdminAuditLog')
      .mockResolvedValueOnce(response)
    const input: ListAdminAuditLogQuery = {
      limit: 20,
      command: 'REAUTHENTICATION'
    }
    const options = phase7AdminQueries.auditLog(input)
    input.limit = 99
    const client = createAuditQueryClient()

    try {
      expect(options.queryKey).toEqual([
        'phase7-admin',
        'audit-log',
        'list',
        { limit: 20, command: 'REAUTHENTICATION' }
      ])
      expect(await client.fetchQuery(options)).toBe(response)
      expect(request).toHaveBeenCalledExactlyOnceWith({
        limit: 20,
        command: 'REAUTHENTICATION'
      })
    } finally {
      client.clear()
    }
  })

  it('keeps the first page cursor absent, forwards the next cursor, and stops after the final page', async () => {
    const cursor = encodePhase7OccurredAtCursor({
      occurredAt: '2026-10-08T00:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000001'
    })
    const firstPage = { items: [], nextCursor: cursor }
    const lastPage = { items: [], nextCursor: null }
    const request = vi
      .spyOn(phase7AdminApi, 'listPhase7AdminAuditLog')
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(lastPage)
    const input = { limit: 20, command: 'REAUTHENTICATION' } as const
    const options = phase7AdminQueries.auditLogConnection(input)
    const client = createAuditQueryClient()
    const observer = new InfiniteQueryObserver(client, options)

    try {
      expect(options.queryKey).toEqual([
        'phase7-admin',
        'audit-log',
        'list',
        'connection',
        input
      ])
      await client.fetchInfiniteQuery(options)
      await observer.fetchNextPage()
      await observer.fetchNextPage()
      expect(request).toHaveBeenCalledTimes(2)
      expect(request).toHaveBeenNthCalledWith(1, input)
      expect(request).toHaveBeenNthCalledWith(2, { ...input, cursor })
      expect(client.getQueryData(options.queryKey)).toEqual({
        pages: [firstPage, lastPage],
        pageParams: [null, cursor]
      })
      expect(observer.getCurrentResult().hasNextPage).toBe(false)
    } finally {
      observer.destroy()
      client.clear()
    }
  })

  it('rejects invalid limits and reversed date ranges before either query sends a request', () => {
    const request = vi.spyOn(phase7AdminApi, 'listPhase7AdminAuditLog')
    const reversedRange = {
      limit: 50,
      occurredFrom: '2026-10-09T00:00:00.000Z',
      occurredTo: '2026-10-08T00:00:00.000Z'
    }

    expect(() => phase7AdminQueries.auditLog({ limit: 0 })).toThrow()
    expect(() =>
      phase7AdminQueries.auditLogConnection({ limit: 101 })
    ).toThrow()
    expect(() => phase7AdminQueries.auditLog(reversedRange)).toThrow()
    expect(() => phase7AdminQueries.auditLogConnection(reversedRange)).toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    ['AUTHENTICATION_REQUIRED', 401],
    ['ADMIN_REQUIRED', 403],
    ['NETWORK', undefined]
  ] as const)(
    'retains the original %s rejection from both audit queries',
    async (code, status) => {
      const error = Object.assign(new Error('audit transport rejected'), {
        code,
        status
      })
      const request = vi
        .spyOn(phase7AdminApi, 'listPhase7AdminAuditLog')
        .mockRejectedValue(error)
      const client = createAuditQueryClient()

      try {
        await expect(
          client.fetchQuery(phase7AdminQueries.auditLog({ limit: 20 }))
        ).rejects.toBe(error)
        await expect(
          client.fetchInfiniteQuery(
            phase7AdminQueries.auditLogConnection({ limit: 20 })
          )
        ).rejects.toBe(error)
        expect(request).toHaveBeenCalledTimes(2)
      } finally {
        client.clear()
      }
    }
  )
})
