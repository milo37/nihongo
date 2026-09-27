import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  runPhase7ReauthenticationStartupMaintenance,
  startPhase7ReauthenticationMaintenance
} from './phase7ReauthenticationStartupMaintenance.js'

const validRow = {
  pendingSessionsDeleted: 0,
  intentsDeleted: 0,
  evidenceDeleted: 0
}

describe('Phase 7 reauthentication startup maintenance', () => {
  it('underfull auth-gateway cleanup을 bounded batch로 정확히 한 번 실행한다', async () => {
    const query = vi.fn().mockResolvedValue([validRow])

    await expect(
      runPhase7ReauthenticationStartupMaintenance({
        $queryRawUnsafe: query
      } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>)
    ).resolves.toBeUndefined()

    expect(query).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM "phase7_cleanup_reauthentication"($1)',
      100
    )
  })

  it('full batch 뒤 underfull batch까지 bounded drain한다', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          ...validRow,
          intentsDeleted: 100,
          pendingSessionsDeleted: 100
        }
      ])
      .mockResolvedValueOnce([{ ...validRow, intentsDeleted: 2 }])

    await expect(
      runPhase7ReauthenticationStartupMaintenance({
        $queryRawUnsafe: query
      } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>)
    ).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('열 번 연속 full batch면 listener 전 fail-closed한다', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        ...validRow,
        intentsDeleted: 100,
        pendingSessionsDeleted: 100
      }
    ])

    await expect(
      runPhase7ReauthenticationStartupMaintenance({
        $queryRawUnsafe: query
      } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>)
    ).rejects.toThrow('Phase 7 reauthentication startup cleanup failed.')
    expect(query).toHaveBeenCalledTimes(10)
  })

  it.each([
    { rows: [] },
    { rows: [validRow, validRow] },
    { rows: [{ ...validRow, pendingSessionsDeleted: -1 }] },
    { rows: [{ ...validRow, intentsDeleted: 0.5 }] },
    { rows: [{ ...validRow, evidenceDeleted: Number.NaN }] }
  ])(
    'cleanup 반환 계약이 깨지면 listener 전 fail-closed한다',
    async ({ rows }) => {
      await expect(
        runPhase7ReauthenticationStartupMaintenance({
          $queryRawUnsafe: vi.fn().mockResolvedValue(rows)
        } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>)
      ).rejects.toThrow('Phase 7 reauthentication startup cleanup failed.')
    }
  )

  it('listener 이후 interval마다 cleanup하고 stop 뒤에는 재실행하지 않는다', async () => {
    vi.useFakeTimers()
    try {
      const query = vi.fn().mockResolvedValue([validRow])
      const onFailure = vi.fn()
      const maintenance = startPhase7ReauthenticationMaintenance({
        client: {
          $queryRawUnsafe: query
        } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>,
        intervalMs: 60_000,
        onFailure
      })

      expect(query).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(query).toHaveBeenCalledOnce()
      expect(onFailure).not.toHaveBeenCalled()

      await maintenance.stop()
      await vi.advanceTimersByTimeAsync(120_000)
      expect(query).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('in-flight cleanup은 겹치지 않고 stop이 DB disconnect 전에 drain한다', async () => {
    vi.useFakeTimers()
    try {
      let resolveQuery: ((rows: readonly [typeof validRow]) => void) | undefined
      const query = vi.fn().mockImplementation(
        () =>
          new Promise<readonly [typeof validRow]>((resolve) => {
            resolveQuery = resolve
          })
      )
      const maintenance = startPhase7ReauthenticationMaintenance({
        client: {
          $queryRawUnsafe: query
        } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>,
        intervalMs: 10,
        onFailure: vi.fn()
      })

      await vi.advanceTimersByTimeAsync(40)
      expect(query).toHaveBeenCalledOnce()

      let stopped = false
      const stopPromise = maintenance.stop().then(() => {
        stopped = true
      })
      await Promise.resolve()
      expect(stopped).toBe(false)
      resolveQuery?.([validRow])
      await stopPromise
      expect(stopped).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('periodic failure를 보고하고 다음 interval에서 다시 시도한다', async () => {
    vi.useFakeTimers()
    try {
      const query = vi
        .fn()
        .mockRejectedValueOnce(new Error('cleanup unavailable'))
        .mockResolvedValueOnce([validRow])
      const onFailure = vi.fn()
      const maintenance = startPhase7ReauthenticationMaintenance({
        client: {
          $queryRawUnsafe: query
        } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>,
        intervalMs: 10,
        onFailure
      })

      await vi.advanceTimersByTimeAsync(10)
      expect(onFailure).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(10)
      expect(query).toHaveBeenCalledTimes(2)
      await maintenance.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('server는 foundation을 조립하지만 HTTP app에는 주입하지 않는다', () => {
    const serverSource = readFileSync(
      new URL('../server.ts', import.meta.url),
      'utf8'
    )
    const appStart = serverSource.indexOf('const app = createApiApp({')
    const listenerStart = serverSource.indexOf(
      'const server = await startApiListener({'
    )
    const appComposition = serverSource.slice(appStart, listenerStart)
    const listenerComposition = serverSource.slice(listenerStart)
    const periodicStart = serverSource.indexOf(
      'const reauthenticationMaintenance ='
    )
    const startedLog = serverSource.indexOf("logger.info('api.started'")
    const shutdownStart = serverSource.indexOf('const shutdown = async')
    const maintenanceStop = serverSource.indexOf(
      'reauthenticationMaintenance?.stop()'
    )
    const gracefulStop = serverSource.indexOf('await stopServerGracefully({')

    expect(serverSource).toContain('createPhase7ReauthenticationContext()')
    expect(serverSource).toContain('createPhase7ReauthenticationAuthApi({')
    expect(serverSource).toContain('createAdminReauthenticationService({')
    expect(appComposition).not.toContain('dormantAdminReauthenticationService')
    expect(appComposition).not.toContain('reauthentication')
    expect(appComposition).toContain(
      'checkReadiness: practiceRuntimeGate.checkReadiness'
    )
    expect(listenerComposition).toContain(
      'checkReadiness: checkStartupReadiness'
    )
    expect(periodicStart).toBeGreaterThan(listenerStart)
    expect(periodicStart).toBeLessThan(startedLog)
    expect(startedLog).toBeLessThan(shutdownStart)
    expect(maintenanceStop).toBeGreaterThan(shutdownStart)
    expect(maintenanceStop).toBeLessThan(gracefulStop)
  })
})
