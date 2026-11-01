const ports = vi.hoisted(() => ({
  spawn: vi.fn(),
  createHttpServer: vi.fn(),
  createNetServer: vi.fn(),
  prepare: vi.fn(),
  cleanupHarness: vi.fn(),
  fixture: vi.fn(),
  parseEnvironment: vi.fn(),
  listener: vi.fn(),
  stop: vi.fn(),
  retire: vi.fn(),
  assets: vi.fn(),
  removeAssets: vi.fn(),
  staticWeb: vi.fn()
}))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  mkdtemp: ports.assets,
  rm: ports.removeAssets
}))
vi.mock('../app/staticWeb.js', () => ({ installStaticWeb: ports.staticWeb }))
vi.mock('node:child_process', () => ({ spawn: ports.spawn }))
vi.mock('node:http', () => ({ createServer: ports.createHttpServer }))
vi.mock('node:net', () => ({ createServer: ports.createNetServer }))
vi.mock('./ownedProcessGroup.js', () => ({
  shouldDetachOwnedProcess: false,
  stopOwnedProcesses: ports.stop,
  retireOwnedProcess: ports.retire
}))
vi.mock('./runAdminApiIntegration.js', () => ({
  preparePhase7IsolatedDatabase: ports.prepare,
  cleanupPhase7IsolatedDatabase: ports.cleanupHarness
}))
vi.mock('./browserFixture.js', () => ({
  createPhase7SsoAdminBrowserApiFixture: ports.fixture
}))
vi.mock('../config/env.js', () => ({
  parseApiEnvironment: ports.parseEnvironment
}))
vi.mock('@hono/node-server', () => ({ getRequestListener: ports.listener }))

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupPhase7BrowserResources,
  closePhase7BrowserApi,
  selectPhase7BrowserSpecs
} from './runAdminBrowser.js'

describe('admin and dashboard browser cleanup caller', () => {
  it('preserves owned processes and withholds fixture and DB cleanup after stop failure', async () => {
    const owned = {
      child: { pid: 424_242 } as ChildProcess,
      label: 'owned-test'
    }
    const processes = [owned]
    const stopFailure = new Error('owned process is still alive')
    const closeControlServer = vi.fn(async () => undefined)
    const disconnectFixture = vi.fn(async () => undefined)
    const cleanupHarness = vi.fn(async () => undefined)

    await expect(
      cleanupPhase7BrowserResources(processes, {
        stopOwnedProcesses: async () => {
          throw stopFailure
        },
        closeControlServer,
        cleanupDatabase: async () => {
          await disconnectFixture()
          await cleanupHarness()
        }
      })
    ).rejects.toThrow()

    expect(processes).toEqual([owned])
    expect(processes[0]).toBe(owned)
    expect(closeControlServer).toHaveBeenCalledOnce()
    expect(disconnectFixture).not.toHaveBeenCalled()
    expect(cleanupHarness).not.toHaveBeenCalled()
  })

  it('clears records only after a successful stop and keeps normal cleanup order', async () => {
    const processes = [{ child: {} as ChildProcess, label: 'stopped-test' }]
    const calls: string[] = []
    await cleanupPhase7BrowserResources(processes, {
      stopOwnedProcesses: async () => {
        calls.push('stop')
      },
      closeControlServer: async () => {
        expect(processes).toEqual([])
        calls.push('control')
      },
      cleanupDatabase: async () => {
        calls.push('fixture')
        calls.push('database')
      }
    })
    expect(processes).toEqual([])
    expect(calls).toEqual(['stop', 'control', 'fixture', 'database'])
  })

  it('keeps database cleanup after successful stop even when the control close fails', async () => {
    const processes = [{ child: {} as ChildProcess, label: 'closed-test' }]
    const closeFailure = new Error('control close failed')
    const cleanupDatabase = vi.fn(async () => undefined)
    await expect(
      cleanupPhase7BrowserResources(processes, {
        stopOwnedProcesses: async () => undefined,
        closeControlServer: async () => {
          throw closeFailure
        },
        cleanupDatabase
      })
    ).rejects.toBe(closeFailure)
    expect(processes).toEqual([])
    expect(cleanupDatabase).toHaveBeenCalledOnce()
  })

  it('returns a database cleanup error after successful process shutdown', async () => {
    const processes = [
      { child: {} as ChildProcess, label: 'database-error-test' }
    ]
    const databaseFailure = new Error('database cleanup failed')
    await expect(
      cleanupPhase7BrowserResources(processes, {
        stopOwnedProcesses: async () => undefined,
        closeControlServer: async () => undefined,
        cleanupDatabase: async () => {
          throw databaseFailure
        }
      })
    ).rejects.toBe(databaseFailure)
    expect(processes).toEqual([])
  })
})

describe('admin browser TEST API listener shutdown', () => {
  it('closes the owned API listener before allowing fixture and harness cleanup', async () => {
    const calls: string[] = []
    const server = {
      close: (callback: (error?: Error) => void) => {
        calls.push('api')
        callback()
      }
    } as unknown as Server
    await cleanupPhase7BrowserResources([], {
      stopOwnedProcesses: async () => {
        calls.push('children')
        await closePhase7BrowserApi(server)
      },
      closeControlServer: async () => {
        calls.push('control')
      },
      cleanupDatabase: async () => {
        calls.push('database')
      }
    })
    expect(calls).toEqual(['children', 'api', 'control', 'database'])
  })
  it('withholds DB cleanup when the owned API listener cannot close', async () => {
    const failure = new Error('API listener remains active')
    const server = {
      close: (callback: (error?: Error) => void) => callback(failure)
    } as unknown as Server
    const cleanupDatabase = vi.fn(async () => undefined)
    const owned = { child: {} as ChildProcess, label: 'owned-web' }
    const processes = [owned]
    await expect(
      cleanupPhase7BrowserResources(processes, {
        stopOwnedProcesses: () => closePhase7BrowserApi(server),
        closeControlServer: async () => undefined,
        cleanupDatabase
      })
    ).rejects.toThrow()
    expect(cleanupDatabase).not.toHaveBeenCalled()
    expect(processes[0]).toBe(owned)
  })
  it('allows cleanup for an absent or not-yet-listening owned server', async () => {
    await expect(closePhase7BrowserApi(undefined)).resolves.toBeUndefined()
    const error = Object.assign(new Error('not started'), {
      code: 'ERR_SERVER_NOT_RUNNING'
    })
    const server = {
      close: (callback: (error?: Error) => void) => callback(error)
    } as unknown as Server
    await expect(closePhase7BrowserApi(server)).resolves.toBeUndefined()
  })
})

describe('admin browser owned API bounded shutdown', () => {
  it('forces connection close at the existing deadline and still withholds DB cleanup', async () => {
    vi.useFakeTimers()
    try {
      const closeAllConnections = vi.fn()
      const server = {
        close: vi.fn(),
        closeAllConnections
      } as unknown as Server
      const cleanupDatabase = vi.fn(async () => undefined)
      const failure = cleanupPhase7BrowserResources([], {
        stopOwnedProcesses: () => closePhase7BrowserApi(server),
        closeControlServer: async () => undefined,
        cleanupDatabase
      }).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(10_000)
      const error = await failure
      expect(error).toBeInstanceOf(AggregateError)
      if (!(error instanceof AggregateError))
        throw new Error('Missing cleanup failure.')
      expect(error.errors).toEqual([
        expect.objectContaining({
          message: 'Server shutdown exceeded 10000ms.'
        }),
        expect.objectContaining({
          message:
            'Phase 10 database cleanup was withheld because an owned process may still be running.'
        })
      ])
      expect(closeAllConnections).toHaveBeenCalledOnce()
      expect(cleanupDatabase).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('admin and dashboard real origin and Mock selection', () => {
  const adminSpec = 'apps/web/e2e/admin-cms.spec.ts'
  const dashboardSpec = 'apps/web/e2e/dashboard.spec.ts'
  const shutdown: string[] = []
  const stoppedLabels: string[][] = []
  let buildRetireCountAtInstall = 0
  const adminGuard = vi.fn()
  const checkReadiness = vi.fn(async () => undefined)
  const snapshot = vi.fn(async () => ({ audit: 0 }))
  const assertExpectedLifecycleDelta = vi.fn(async () => undefined)
  const disconnect = vi.fn(async () => {
    shutdown.push('fixture')
  })
  const fetchReady = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(0)
  }))

  beforeEach(() => {
    vi.clearAllMocks()
    ports.assets.mockImplementation(async (prefix: string) =>
      prefix.includes('-admin-')
        ? '/tmp/phase7-browser-admin-unit'
        : '/tmp/phase7-browser-web-unit'
    )
    ports.removeAssets.mockResolvedValue(undefined)
    buildRetireCountAtInstall = 0
    ports.staticWeb.mockImplementation(() => {
      buildRetireCountAtInstall = ports.retire.mock.calls.length
    })
    shutdown.length = 0
    stoppedLabels.length = 0
    let nextPort = 4100
    let nextPid = 100_000
    let serverCount = 0
    ports.createNetServer.mockImplementation(() => {
      const port = nextPort++
      return {
        once: vi.fn(),
        listen: (_port: number, _host: string, ready: () => void) => ready(),
        address: () => ({ port }),
        close: (closed: () => void) => closed()
      }
    })
    ports.createHttpServer.mockImplementation(() => {
      const label = serverCount++ === 0 ? 'api' : 'control'
      return {
        once: vi.fn(),
        listen: (_port: number, _host: string, ready: () => void) => ready(),
        close: (closed: () => void) => {
          shutdown.push(label)
          closed()
        }
      }
    })
    ports.spawn.mockImplementation(
      (_command: string, args: readonly string[]) => {
        const child = Object.assign(new EventEmitter(), {
          pid: nextPid++,
          exitCode: null,
          signalCode: null
        })
        if (!args.includes('vite') || args.includes('build'))
          queueMicrotask(() => child.emit('close', 0, null))
        return child
      }
    )
    ports.retire.mockImplementation(
      async (processes: unknown[], owned: unknown) => {
        processes.splice(processes.indexOf(owned), 1)
      }
    )
    ports.stop.mockImplementation(
      async (processes: readonly { label: string }[]) => {
        stoppedLabels.push(processes.map(({ label }) => label))
        shutdown.push('children')
      }
    )
    ports.cleanupHarness.mockImplementation(async () => {
      shutdown.push('harness')
    })
    ports.prepare.mockResolvedValue({
      applicationDatabaseUrl: 'test-application',
      authGatewayDatabaseUrl: 'test-gateway',
      adminDatabaseUrl: 'test-owner',
      sharedEnvironment: { DEPLOYMENT_ENVIRONMENT: 'TEST' }
    })
    ports.parseEnvironment.mockImplementation(
      (environment: unknown) => environment
    )
    ports.fixture.mockResolvedValue({
      app: { fetch: vi.fn() },
      adminGuard,
      checkReadiness,
      fixture: { author: { userId: 'test-author' } },
      database: { snapshot, assertExpectedLifecycleDelta, disconnect }
    })
    vi.stubGlobal('fetch', fetchReady)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('selects admin only for real and preserves both dashboard modes', () => {
    expect(selectPhase7BrowserSpecs('real', false)).toEqual([adminSpec])
    expect(selectPhase7BrowserSpecs('real', true)).toEqual([
      adminSpec,
      dashboardSpec
    ])
    expect(selectPhase7BrowserSpecs('mock', true)).toEqual([dashboardSpec])
    expect(() => selectPhase7BrowserSpecs('mock', false)).toThrow(
      'requires real mode'
    )
  })

  it('rejects standalone admin Mock before creating any owned resources', async () => {
    vi.resetModules()
    vi.stubEnv('PHASE8_BROWSER_ACCEPTANCE', '0')
    const runner = await import('./runAdminBrowser.js')
    await expect(runner.runMock()).rejects.toThrow('requires real mode')
    expect(ports.spawn).not.toHaveBeenCalled()
    expect(ports.prepare).not.toHaveBeenCalled()
    expect(ports.createNetServer).not.toHaveBeenCalled()
    expect(ports.createHttpServer).not.toHaveBeenCalled()
  })

  it('serves only web and selects only the dashboard with dashboard acceptance Mock', async () => {
    vi.resetModules()
    vi.stubEnv('PHASE8_BROWSER_ACCEPTANCE', '1')
    vi.stubEnv('NIHONGO_ADMIN_PROXY_TARGET', 'http://parent.invalid')
    const runner = await import('./runAdminBrowser.js')
    await runner.runMock()
    const calls = ports.spawn.mock.calls
    const vite = calls.filter(([, args]) => args.includes('vite'))
    expect(vite).toHaveLength(1)
    expect(vite[0]?.[1]).toContain('@nihongo/web')
    expect(vite[0]?.[2].env).toMatchObject({
      VITE_API_MODE: 'mock',
      VITE_API_BASE_URL: '/api'
    })
    expect(vite[0]?.[2].env.NIHONGO_ADMIN_PROXY_TARGET).toBeUndefined()
    const playwright = calls.find(([, args]) => args.includes('playwright'))
    expect(playwright?.[1]).toContain(dashboardSpec)
    expect(playwright?.[1]).not.toContain(adminSpec)
    expect(ports.prepare).not.toHaveBeenCalled()
    expect(ports.fixture).not.toHaveBeenCalled()
    expect(ports.createHttpServer).not.toHaveBeenCalled()
    await runner.cleanup()
    expect(shutdown).toEqual(['children'])
  })

  it.each(['0', '1'])(
    'serves production static assets and API on one public origin (dashboard=%s)',
    async (phase8) => {
      vi.resetModules()
      vi.stubEnv('PHASE8_BROWSER_ACCEPTANCE', phase8)
      const runner = await import('./runAdminBrowser.js')
      await runner.runReal()
      const calls = ports.spawn.mock.calls
      expect(
        calls.some(
          ([, args]) =>
            args.includes('src/server.ts') ||
            (args.includes('@nihongo/admin') && !args.includes('build')) ||
            (args.includes('vite') && !args.includes('build'))
        )
      ).toBe(false)
      const builds = calls.filter(
        ([, args]) => args.includes('vite') && args.includes('build')
      )
      expect(builds).toHaveLength(2)
      expect(buildRetireCountAtInstall).toBe(2)
      for (const [index, artifact] of ['web', 'admin'].entries()) {
        expect(builds[index]?.[1]).toEqual([
          '--filter',
          `@nihongo/${artifact}`,
          'exec',
          'vite',
          'build',
          '--outDir',
          `/tmp/phase7-browser-${artifact}-unit`,
          '--emptyOutDir'
        ])
        expect(builds[index]?.[2].env).toMatchObject({
          NODE_ENV: 'production',
          VITE_API_MODE: 'real',
          VITE_API_BASE_URL: '/api',
          VITE_RELEASE_ID: '0'.repeat(40)
        })
      }
      expect(ports.staticWeb).toHaveBeenCalledWith({
        app: expect.anything(),
        releaseId: '0'.repeat(40),
        webAssetsDirectory: '/tmp/phase7-browser-web-unit',
        adminAssetsDirectory: '/tmp/phase7-browser-admin-unit',
        adminGuard
      })
      const playwright = calls.find(([, args]) => args.includes('playwright'))
      expect(playwright?.[2].env).toMatchObject({
        PHASE7_BROWSER_ADMIN_ORIGIN: 'http://127.0.0.1:4100',
        PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4100',
        PHASE7_BROWSER_MODE: 'real'
      })
      expect(playwright?.[1]).toContain(adminSpec)
      expect(playwright?.[1].includes(dashboardSpec)).toBe(phase8 === '1')
      expect(ports.prepare).toHaveBeenCalledWith({
        seedRuns: 2,
        artifactsPrepared: false
      })
      expect(ports.fixture.mock.calls[0]?.[1]).toBe('admin-a1-a8')
      expect(checkReadiness).toHaveBeenCalledOnce()
      expect(assertExpectedLifecycleDelta).toHaveBeenCalledWith({ audit: 0 })
      await runner.cleanup()
      expect(stoppedLabels).toEqual([[]])
      expect(shutdown).toEqual([
        'children',
        'api',
        'control',
        'fixture',
        'harness'
      ])
      expect(disconnect).toHaveBeenCalledOnce()
      expect(ports.removeAssets.mock.calls).toEqual([
        ['/tmp/phase7-browser-web-unit', { recursive: true, force: true }],
        ['/tmp/phase7-browser-admin-unit', { recursive: true, force: true }]
      ])
    }
  )
  it('fails closed before building or listening if the fixture has no admin guard', async () => {
    vi.resetModules()
    ports.fixture.mockResolvedValueOnce({
      app: { fetch: vi.fn() },
      adminGuard: undefined,
      checkReadiness,
      fixture: { author: { userId: 'test-author' } },
      database: { snapshot, assertExpectedLifecycleDelta, disconnect }
    })
    const runner = await import('./runAdminBrowser.js')
    await expect(runner.runReal()).rejects.toThrow(
      'requires an administrator static guard'
    )
    expect(ports.spawn).not.toHaveBeenCalled()
    expect(ports.staticWeb).not.toHaveBeenCalled()
    expect(ports.createHttpServer).not.toHaveBeenCalled()
    await runner.cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(ports.cleanupHarness).toHaveBeenCalledOnce()
  })

  it('propagates admin build failure before static installation and cleans both roots', async () => {
    vi.resetModules()
    ports.spawn.mockImplementation(
      (_command: string, args: readonly string[]) => {
        const child = Object.assign(new EventEmitter(), {
          pid: 100_001,
          exitCode: null,
          signalCode: null
        })
        queueMicrotask(() =>
          child.emit('close', args.includes('@nihongo/admin') ? 1 : 0, null)
        )
        return child
      }
    )
    const runner = await import('./runAdminBrowser.js')
    await expect(runner.runReal()).rejects.toThrow('exit 1')
    expect(ports.staticWeb).not.toHaveBeenCalled()
    expect(ports.createHttpServer).not.toHaveBeenCalled()
    expect(
      ports.spawn.mock.calls.some(([, args]) => args.includes('playwright'))
    ).toBe(false)
    await runner.cleanup()
    expect(ports.removeAssets.mock.calls).toEqual([
      ['/tmp/phase7-browser-web-unit', { recursive: true, force: true }],
      ['/tmp/phase7-browser-admin-unit', { recursive: true, force: true }]
    ])
    expect(disconnect).toHaveBeenCalledOnce()
    expect(ports.cleanupHarness).toHaveBeenCalledOnce()
  })

  it.each(['web', 'admin'])(
    'attempts both root removals and propagates %s removal failure',
    async (artifact) => {
      vi.resetModules()
      const failure = new Error(`${artifact} removal failed`)
      ports.removeAssets.mockImplementation(async (directory: string) => {
        if (directory === `/tmp/phase7-browser-${artifact}-unit`) throw failure
      })
      const runner = await import('./runAdminBrowser.js')
      await runner.runReal()
      await expect(runner.cleanup()).rejects.toBe(failure)
      expect(ports.removeAssets.mock.calls).toEqual([
        ['/tmp/phase7-browser-web-unit', { recursive: true, force: true }],
        ['/tmp/phase7-browser-admin-unit', { recursive: true, force: true }]
      ])
      expect(shutdown).toEqual([
        'children',
        'api',
        'control',
        'fixture',
        'harness'
      ])
    }
  )
})

describe('admin browser mandatory public origin environment', () => {
  it.each(['real', 'mock'] as const)(
    'overrides stale origin/mode env with the actual %s boundary',
    async (mode) => {
      const runner = await import('./runAdminBrowser.js')
      const result = runner.createPhase7BrowserPlaywrightEnvironment(
        mode,
        'http://127.0.0.1:33493',
        {
          PHASE7_BROWSER_ADMIN_ORIGIN: 'http://old.invalid',
          PLAYWRIGHT_BASE_URL: 'http://old.invalid',
          PHASE7_BROWSER_MODE: 'other'
        }
      )
      expect(result.PHASE7_BROWSER_ADMIN_ORIGIN).toBe('http://127.0.0.1:33493')
      expect(result.PLAYWRIGHT_BASE_URL).toBe('http://127.0.0.1:33493')
      expect(result.PHASE7_BROWSER_MODE).toBe(mode)
      expect(result.PHASE8_BROWSER_MODE).toBe(mode)
    }
  )
})
