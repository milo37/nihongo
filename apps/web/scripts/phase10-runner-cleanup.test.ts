import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  createServer: vi.fn(),
  stopOwnedProcesses: vi.fn(),
  retireOwnedProcess: vi.fn(),
  prepareDatabase: vi.fn(),
  cleanupDatabase: vi.fn(),
  prepareActors: vi.fn(),
  captureSnapshot: vi.fn(),
  assertDatabaseContract: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:net', () => ({ createServer: mocks.createServer }))
vi.mock('../../../apps/api/src/e2e/ownedProcessGroup.js', () => ({
  shouldDetachOwnedProcess: false,
  stopOwnedProcesses: mocks.stopOwnedProcesses,
  retireOwnedProcess: mocks.retireOwnedProcess
}))

vi.mock('../../../apps/api/src/e2e/runPhase7ApiIntegration.js', () => ({
  preparePhase7IsolatedDatabase: mocks.prepareDatabase,
  cleanupPhase7IsolatedDatabase: mocks.cleanupDatabase
}))
vi.mock('../../../apps/api/src/e2e/phase9BrowserApi.js', () => ({
  preparePhase9BrowserActors: mocks.prepareActors
}))
vi.mock('../../../scripts/phase9-database-contract.mjs', () => ({
  capturePhase9DatabaseSnapshot: mocks.captureSnapshot,
  assertPhase9DatabaseContract: mocks.assertDatabaseContract
}))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile
}))

type ChildOutcome = {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}
type Scenario = ChildOutcome & {
  readonly early?: boolean
  readonly forced?: boolean
  readonly delayed?: boolean
  readonly missing?: boolean
}

const scenarios: readonly (readonly [string, Scenario, number])[] = [
  ['normal cleanup completion', { code: 0, signal: null }, 0],
  ['close after leader exit', { code: 0, signal: null, delayed: true }, 0],
  ['disconnect cleanup failure', { code: 1, signal: null }, 1],
  ['SQL cleanup failure', { code: 1, signal: null }, 1],
  ['early successful exit', { code: 0, signal: null, early: true }, 1],
  ['early failed exit', { code: 1, signal: null, early: true }, 1],
  ['forced stop despite zero exit', { code: 0, signal: null, forced: true }, 1],
  ['signal termination', { code: null, signal: 'SIGKILL' }, 1],
  ['missing close result', { code: 0, signal: null, missing: true }, 1]
]

const makeChild = (): ChildProcess =>
  Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    pid: undefined
  }) as unknown as ChildProcess

const finish = (child: ChildProcess, outcome: ChildOutcome): void => {
  Object.assign(child, { exitCode: outcome.code, signalCode: outcome.signal })
  child.emit('exit', outcome.code, outcome.signal)
  child.emit('close', outcome.code, outcome.signal)
}

describe('Phase9/10 browser runner lifecycle', () => {
  const originalArgv = process.argv
  const originalExitCode = process.exitCode
  let testTemp: string
  let originalSignalListeners: Map<
    NodeJS.Signals,
    ((signal: NodeJS.Signals) => void)[]
  >

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    testTemp = mkdtempSync(join(tmpdir(), 'jlp541-web-runner-'))
    vi.stubEnv('RUNNER_TEMP', testTemp)
    vi.stubEnv('GITHUB_RUN_ID', undefined)
    vi.stubEnv('JLP541_BROWSER_ARTIFACTS_PREPARED', undefined)
    vi.stubEnv('PHASE8_BROWSER_MODE', undefined)
    vi.stubEnv('PHASE9_BROWSER_MODE', undefined)
    vi.stubEnv('PHASE10_BROWSER_MODE', undefined)
    process.argv = [...originalArgv.slice(0, 2), 'real']
    process.exitCode = undefined
    originalSignalListeners = new Map(
      (['SIGINT', 'SIGTERM'] as const).map((signal) => [
        signal,
        process.listeners(signal)
      ])
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 }))
    )
    mocks.createServer.mockImplementation(() => ({
      once: vi.fn(),
      address: () => ({ port: 32123 }),
      listen: (_port: number, _host: string, callback: () => void) =>
        callback(),
      close: (callback: () => void) => callback()
    }))
    mocks.retireOwnedProcess.mockImplementation(
      async (processes: unknown[], owned: unknown) => {
        processes.splice(processes.indexOf(owned), 1)
      }
    )
  })

  afterEach(() => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!originalSignalListeners.get(signal)?.includes(listener)) {
          process.removeListener(signal, listener)
        }
      }
    }
    process.argv = originalArgv
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(testTemp, { recursive: true, force: true })
  })

  it.each(scenarios)('%s', async (_name, scenario, expectedExitCode) => {
    const api = makeChild()
    const web = makeChild()
    const playwright = makeChild()
    mocks.spawn.mockImplementation(() => {
      const call = mocks.spawn.mock.calls.length
      if (call === 1) return api
      if (call === 2) return web
      if (call !== 3) throw new Error('Unexpected owned process.')
      queueMicrotask(() => {
        if (scenario.early) finish(api, scenario)
        finish(playwright, { code: 0, signal: null })
      })
      return playwright
    })
    mocks.stopOwnedProcesses.mockImplementation(
      async (
        processes: readonly {
          readonly child: ChildProcess
          readonly label: string
        }[],
        options: {
          readonly onForceKill: (owned: (typeof processes)[number]) => void
        }
      ) => {
        const ownedApi = processes.find(({ child }) => child === api)
        if (!ownedApi) throw new Error('Missing owned API process.')
        if (scenario.forced) options.onForceKill(ownedApi)
        if (scenario.missing) Object.assign(api, { exitCode: scenario.code })
        else if (scenario.delayed) {
          Object.assign(api, { exitCode: scenario.code })
          setTimeout(() => finish(api, scenario), 5)
        } else if (!scenario.early) finish(api, scenario)
        finish(web, { code: null, signal: 'SIGTERM' })
      }
    )
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const { main } = await import('../../../scripts/runPhase10Browser.js')

    await main()

    expect(process.exitCode ?? 0).toBe(expectedExitCode)
    const output = stdout.mock.calls
      .map(([message]) => String(message))
      .join('')
    const errors = stderr.mock.calls
      .map(([message]) => String(message))
      .join('')
    if (expectedExitCode === 0) {
      expect(output).toContain('phase10.browser.real.passed')
      expect(errors).not.toContain('phase10.browser.real.failed')
    } else {
      expect(output).not.toContain('phase10.browser.real.passed')
      expect(errors).toContain('phase10.browser.real.failed')
    }
    expect(mocks.spawn.mock.calls[0]?.[0]).toBe(process.execPath)
    expect(mocks.spawn.mock.calls[0]?.[1]).toEqual([
      '--import',
      expect.stringContaining('/tsx/'),
      'src/e2e/runPhase7ApiIntegration.ts'
    ])
    expect(mocks.spawn.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ cwd: expect.stringContaining('/apps/api') })
    )
    expect(mocks.retireOwnedProcess).toHaveBeenCalledOnce()
    expect(mocks.stopOwnedProcesses).toHaveBeenCalledOnce()
  })
  const assertMockLifecycle = async (
    scenario: string,
    artifactsPrepared: boolean
  ): Promise<void> => {
    const web = makeChild()
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
    const stopped: string[][] = []
    const cancellation =
      scenario === 'SIGINT during Playwright' ||
      scenario === 'SIGTERM during Playwright'
    let playwrightChild: ChildProcess | undefined
    let resolveExit: () => void = () => {}
    const exitObserved = new Promise<void>((done) => {
      resolveExit = done
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      resolveExit()
      return undefined as never
    })
    mocks.spawn.mockImplementation(
      (_command: string, args: string[], options) => {
        calls.push({ args, env: options.env })
        if (args.includes('@nihongo/web')) {
          if (scenario === 'web exit') finish(web, { code: 1, signal: null })
          return web
        }
        const child = makeChild()
        if (
          args.includes('@nihongo/contracts') ||
          args.includes('@nihongo/domain')
        ) {
          queueMicrotask(() => finish(child, { code: 0, signal: null }))
        } else if (args.includes('playwright')) {
          playwrightChild = child
          queueMicrotask(() => {
            if (cancellation) {
              const signal =
                scenario === 'SIGINT during Playwright' ? 'SIGINT' : 'SIGTERM'
              process.emit(signal, signal)
            } else {
              finish(child, {
                code:
                  scenario === 'Playwright failure' ||
                  scenario === 'Playwright and stop failure'
                    ? 7
                    : 0,
                signal: null
              })
            }
          })
        } else {
          throw new Error(
            'Mock runner started an unexpected API or admin process.'
          )
        }
        return child
      }
    )
    mocks.stopOwnedProcesses.mockImplementation(
      async (processes: readonly { label: string }[]) => {
        stopped.push(processes.map(({ label }) => label))
        if (cancellation && playwrightChild)
          finish(playwrightChild, { code: 7, signal: null })
        if (
          scenario === 'stop failure' ||
          scenario === 'Playwright and stop failure'
        ) {
          throw new Error('Owned process remains')
        }
        finish(web, { code: null, signal: 'SIGTERM' })
      }
    )
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    if (cancellation)
      process.argv[1] = resolve(
        process.cwd(),
        '../../scripts/runPhase9Browser.ts'
      )
    const runner = await import('../../../scripts/runPhase9Browser.js')
    if (cancellation) {
      await exitObserved
      await new Promise<void>((done) => setImmediate(done))
      expect(exit).toHaveBeenCalledWith(
        scenario === 'SIGINT during Playwright' ? 130 : 143
      )
    } else {
      await runner.main()
      expect(exit).not.toHaveBeenCalled()
    }

    const failed =
      [
        'web exit',
        'Playwright failure',
        'stop failure',
        'Playwright and stop failure'
      ].includes(scenario) || cancellation
    expect(process.exitCode ?? 0).toBe(failed ? 1 : 0)
    expect(mocks.prepareDatabase).not.toHaveBeenCalled()
    expect(mocks.prepareActors).not.toHaveBeenCalled()
    expect(mocks.cleanupDatabase).not.toHaveBeenCalled()
    expect(mocks.captureSnapshot).not.toHaveBeenCalled()
    expect(
      calls.some(
        ({ args }) =>
          args.includes('@nihongo/api') || args.includes('@nihongo/admin')
      )
    ).toBe(false)
    const builds = calls.filter(
      ({ args }) =>
        args.includes('@nihongo/contracts') || args.includes('@nihongo/domain')
    )
    expect(builds.map(({ args }) => args[1])).toEqual(
      artifactsPrepared ? [] : ['@nihongo/contracts', '@nihongo/domain']
    )
    const webCall = calls.find(({ args }) => args.includes('@nihongo/web'))
    expect(webCall?.env).toMatchObject({
      NIHONGO_API_PROXY_TARGET: 'http://127.0.0.1:0',
      VITE_API_MODE: 'mock'
    })
    const playwright = calls.filter(({ args }) => args.includes('playwright'))
    if (!failed || scenario === 'stop failure') {
      expect(
        playwright.map(({ args }) =>
          args.find((arg) => arg.endsWith('.spec.ts'))
        )
      ).toEqual([
        'apps/web/e2e/phase8-dashboard-real-mock.spec.ts',
        'apps/web/e2e/phase9-accessibility.spec.ts',
        'apps/web/e2e/phase10-journeys-real-mock.spec.ts'
      ])
      expect(
        playwright.map(({ env }) => [
          env.PHASE8_BROWSER_MODE,
          env.PHASE9_BROWSER_MODE,
          env.PHASE10_BROWSER_MODE
        ])
      ).toEqual([
        ['mock', undefined, undefined],
        [undefined, 'mock', undefined],
        [undefined, undefined, 'mock']
      ])
    } else if (scenario === 'web exit') {
      expect(playwright).toHaveLength(0)
    } else {
      expect(playwright).toHaveLength(1)
    }
    expect(stopped).toHaveLength(1)
    expect(stopped[0]).toContain('phase9-mock-web')
    if (cancellation)
      expect(stopped[0]).toEqual(
        expect.arrayContaining([
          expect.stringContaining('pnpm exec playwright')
        ])
      )
    const output = stdout.mock.calls.map(([value]) => String(value)).join('')
    const errors = stderr.mock.calls.map(([value]) => String(value)).join('')
    expect(output.includes('phase9.browser.mock.passed')).toBe(!failed)
    expect(errors.includes('phase9.browser.mock.failed')).toBe(failed)
    if (scenario === 'Playwright and stop failure')
      expect(errors).toContain('cleanup both failed')
  }

  it.each(
    (
      [
        'ready',
        'database preparation failure',
        'actor preparation failure',
        'API exit',
        'API error',
        'web exit',
        'SIGINT during Playwright',
        'SIGTERM during Playwright',
        'Playwright and stop failure',
        'admin exit',
        'Playwright failure',
        'stop failure',
        'occupied port',
        'late collision',
        'admin exits during Playwright',
        'admin errors during Playwright',
        'admin exits during evidence',
        'split ready'
      ] as const
    ).flatMap((scenario) =>
      (['real', 'mock'] as const)
        .filter(
          (mode) =>
            !(mode === 'mock' && scenario === 'admin exits during evidence')
        )
        .flatMap((mode) =>
          [
            'ready',
            'database preparation failure',
            'Playwright failure',
            'SIGTERM during Playwright'
          ].includes(scenario)
            ? [
                [mode, scenario, false] as const,
                [mode, scenario, true] as const
              ]
            : [[mode, scenario, false] as const]
        )
    )
  )(
    'Phase9 %s lifecycle boundary: %s (prepared=%s)',
    async (mode, scenario, artifactsPrepared) => {
      process.argv = [...originalArgv.slice(0, 2), mode]
      vi.stubEnv(
        'JLP541_BROWSER_ARTIFACTS_PREPARED',
        artifactsPrepared ? '1' : undefined
      )
      if (mode === 'mock') {
        await assertMockLifecycle(scenario, artifactsPrepared)
        return
      }
      vi.stubEnv('NIHONGO_API_PROXY_TARGET', undefined)
      vi.stubEnv('PHASE9_BROWSER_FIXTURE', undefined)
      vi.stubEnv('GOOGLE_CLIENT_SECRET', 'excluded-provider-test-value')
      const fixture = { owner: 'same-invocation-test-fixture' }
      const identities = [{ owner: 'same-invocation-test-actor' }]
      const lifecycle: string[] = []
      const cancellation =
        scenario === 'SIGINT during Playwright' ||
        scenario === 'SIGTERM during Playwright'
      let resolveExit: () => void = () => {}
      const exitObserved = new Promise<void>((done) => {
        resolveExit = done
      })
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        resolveExit()
        return undefined as never
      })
      const originalAggregateError = AggregateError
      const aggregates: unknown[][] = []
      vi.stubGlobal(
        'AggregateError',
        class extends originalAggregateError {
          constructor(errors: Iterable<unknown>, message?: string) {
            const causes = [...errors]
            aggregates.push(causes)
            super(causes, message)
          }
        }
      )
      let dynamicPort = 32123
      mocks.createServer.mockImplementation(() => {
        let assignedPort = 0
        return {
          once: vi.fn(),
          address: () => ({ port: assignedPort }),
          listen: (port: number, _host: string, ready: () => void) => {
            assignedPort = port || dynamicPort++
            ready()
          },
          close: (closed: () => void) => closed()
        }
      })
      const api = makeChild()
      const admin = makeChild()
      const web = makeChild()
      const playwright = makeChild()
      const stopped: string[][] = []
      let adminReady = false
      let commandRetired = false
      mocks.retireOwnedProcess.mockImplementation(
        async (processes: unknown[], owned: unknown) => {
          if (scenario === 'admin exits during Playwright')
            await new Promise<void>((resolve) => setImmediate(resolve))
          processes.splice(processes.indexOf(owned), 1)
          commandRetired = true
        }
      )
      if (scenario === 'occupied port') {
        mocks.createServer.mockImplementation(() => {
          let onError: ((error: Error) => void) | undefined
          return {
            once: (_event: string, listener: (error: Error) => void) => {
              onError = listener
            },
            address: () => ({ port: 32123 }),
            listen: (port: number, _host: string, ready: () => void) => {
              if (port === 5175)
                onError?.(
                  Object.assign(new Error('listen EADDRINUSE localhost:5175'), {
                    code: 'EADDRINUSE'
                  })
                )
              else ready()
            },
            close: (closed: () => void) => closed()
          }
        })
      }
      let foreignListener = false
      mocks.prepareDatabase.mockImplementation(async () => {
        lifecycle.push('database prepared')
        if (scenario === 'database preparation failure')
          throw new Error('TEST database preparation failed')
        if (scenario === 'late collision') foreignListener = true
        return {
          sharedEnvironment: { DEPLOYMENT_ENVIRONMENT: 'TEST' },
          adminDatabaseUrl: 'unit-test-owner'
        }
      })
      mocks.cleanupDatabase.mockImplementation(async () => {
        lifecycle.push('database cleaned')
      })
      mocks.prepareActors.mockImplementation(async ({ environment }) => {
        lifecycle.push('actors prepared')
        expect(environment).toMatchObject({
          DEPLOYMENT_ENVIRONMENT: 'TEST',
          BETTER_AUTH_URL: 'http://127.0.0.1:32123',
          TRUSTED_ORIGINS: 'http://127.0.0.1:32124'
        })
        expect(environment.GOOGLE_CLIENT_SECRET).toBeUndefined()
        if (scenario === 'actor preparation failure')
          throw new Error('TEST actors failed')
        return { identities, fixture }
      })
      mocks.captureSnapshot.mockResolvedValue({})
      mocks.assertDatabaseContract.mockImplementation(async () => {
        if (scenario === 'admin exits during evidence')
          finish(admin, { code: 0, signal: null })
        return {}
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === 'http://127.0.0.1:32123/health/ready') {
            if (scenario === 'API error') {
              api.emit('error', new Error('Owned API failed before readiness'))
              throw new Error('Owned API unavailable')
            }
            lifecycle.push('API ready')
          }
          if (url === 'http://127.0.0.1:32124') lifecycle.push('web ready')
          if (url === 'http://localhost:5175/admin/') {
            lifecycle.push('admin ready')
            adminReady = true
            if (scenario === 'occupied port' || foreignListener)
              setImmediate(() => finish(admin, { code: 1, signal: null }))
          }
          return new Response(null, { status: 200 })
        })
      )
      mocks.spawn.mockImplementation((_command: string, args: string[]) => {
        if (args.includes('src/e2e/phase9BrowserApi.ts')) {
          lifecycle.push('API spawned')
          if (scenario === 'API exit') finish(api, { code: 1, signal: null })
          return api
        }
        if (
          args.includes('@nihongo/contracts') ||
          args.includes('@nihongo/domain')
        ) {
          const build = makeChild()
          queueMicrotask(() => finish(build, { code: 0, signal: null }))
          return build
        }
        if (args.includes('@nihongo/admin')) {
          lifecycle.push('admin spawned')
          if (scenario === 'admin exit')
            finish(admin, { code: 1, signal: null })
          else if (scenario !== 'late collision') {
            queueMicrotask(() => {
              const output = admin.stdout
              if (scenario === 'split ready') {
                const prefix = Buffer.from('  \u001b[32m\u279c\u001b[0m  Lo')
                output?.emit('data', prefix.subarray(0, 8))
                output?.emit('data', prefix.subarray(8))
                output?.emit('data', Buffer.from('cal:   http://local'))
                output?.emit('data', Buffer.from('host:5175/admin/\n'))
              } else {
                output?.emit(
                  'data',
                  Buffer.from(
                    '  \u279c  Local:   http://localhost:5175/admin/\n'
                  )
                )
              }
            })
          }
          return admin
        }
        if (args.includes('@nihongo/web')) {
          lifecycle.push('web spawned')
          if (scenario === 'web exit') finish(web, { code: 1, signal: null })
          return web
        }
        if (!args.includes('playwright')) throw new Error('Unexpected child.')
        expect(adminReady, 'Playwright must wait for the owned admin').toBe(
          true
        )
        lifecycle.push('Playwright spawned')
        const completePlaywright = () => {
          if (scenario === 'admin exits during Playwright')
            finish(admin, { code: 1, signal: null })
          if (scenario === 'admin errors during Playwright')
            admin.emit(
              'error',
              new Error('Owned admin failed during Playwright')
            )
          if (scenario === 'SIGINT during Playwright') {
            process.emit('SIGINT', 'SIGINT')
            return
          }
          if (scenario === 'SIGTERM during Playwright') {
            process.emit('SIGTERM', 'SIGTERM')
            return
          }
          finish(playwright, {
            code: [
              'Playwright failure',
              'Playwright and stop failure',
              'SIGINT during Playwright',
              'SIGTERM during Playwright'
            ].includes(scenario)
              ? 7
              : 0,
            signal: null
          })
        }
        if (scenario === 'late collision') setImmediate(completePlaywright)
        else queueMicrotask(completePlaywright)
        return playwright
      })
      mocks.stopOwnedProcesses.mockImplementation(
        async (processes: readonly { label: string }[]) => {
          lifecycle.push('processes stopped')
          stopped.push(processes.map(({ label }) => label))
          if (
            scenario === 'SIGINT during Playwright' ||
            scenario === 'SIGTERM during Playwright'
          )
            finish(playwright, { code: 7, signal: null })
          if (scenario === 'admin exits during Playwright')
            expect(commandRetired).toBe(true)
          if (scenario === 'ready' || scenario === 'split ready')
            finish(admin, { code: null, signal: 'SIGTERM' })
          if (
            scenario === 'stop failure' ||
            scenario === 'Playwright and stop failure'
          )
            throw new Error('Owned process remains')
        }
      )
      const stdout = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)
      const stderr = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true)
      if (cancellation)
        process.argv[1] = resolve(
          process.cwd(),
          '../../scripts/runPhase9Browser.ts'
        )
      const { main } = await import('../../../scripts/runPhase9Browser.js')
      if (cancellation) {
        await exitObserved
        await new Promise<void>((done) => setImmediate(done))
      } else {
        await main()
      }
      expect(admin.listenerCount('exit')).toBe(0)
      if (scenario === 'occupied port') {
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(process.exitCode).toBe(1)
        expect(mocks.spawn).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
        expect(mocks.prepareDatabase).not.toHaveBeenCalled()
        expect(mocks.cleanupDatabase).not.toHaveBeenCalled()
        expect(
          stderr.mock.calls.map(([value]) => String(value)).join('')
        ).toContain('EADDRINUSE')
        return
      }
      const success = scenario === 'ready' || scenario === 'split ready'
      expect(process.exitCode ?? 0).toBe(success ? 0 : 1)
      expect(mocks.prepareDatabase).toHaveBeenCalledWith({
        seedRuns: 2,
        artifactsPrepared
      })
      if (
        [
          'database preparation failure',
          'actor preparation failure',
          'API exit',
          'API error'
        ].includes(scenario)
      ) {
        expect(
          mocks.spawn.mock.calls.some(
            ([, args]) =>
              args.includes('@nihongo/admin') || args.includes('playwright')
          )
        ).toBe(false)
        expect(mocks.cleanupDatabase).toHaveBeenCalledOnce()
        expect(lifecycle.indexOf('database cleaned')).toBeGreaterThan(
          lifecycle.indexOf('processes stopped')
        )
        return
      }
      const apiCall = mocks.spawn.mock.calls.find(([, args]) =>
        args.includes('src/e2e/phase9BrowserApi.ts')
      )
      expect(apiCall?.[2].env).toMatchObject({
        TRUSTED_ORIGINS: 'http://127.0.0.1:32124',
        BETTER_AUTH_URL: 'http://127.0.0.1:32123',
        PHASE9_TEST_SSO_IDENTITIES: JSON.stringify(identities)
      })
      const adminCall = mocks.spawn.mock.calls.find(([, args]) =>
        args.includes('@nihongo/admin')
      )
      expect(adminCall?.[1]).toEqual([
        '--filter',
        '@nihongo/admin',
        'exec',
        'vite',
        '--mode',
        'test',
        '--host',
        'localhost',
        '--port',
        '5175',
        '--strictPort'
      ])
      expect(adminCall?.[2].env).toMatchObject({
        NIHONGO_API_PROXY_TARGET: 'http://127.0.0.1:32123',
        VITE_API_BASE_URL: '/api',
        VITE_API_MODE: 'real'
      })
      expect(stopped).toEqual([
        scenario === 'admin exit' || scenario === 'late collision'
          ? [`phase9-${mode}-api`, `phase9-${mode}-admin`]
          : [
              `phase9-${mode}-api`,
              `phase9-${mode}-admin`,
              `phase9-${mode}-web`,
              ...([
                'SIGINT during Playwright',
                'SIGTERM during Playwright'
              ].includes(scenario)
                ? [expect.stringContaining('pnpm exec playwright')]
                : [])
            ]
      ])
      if (scenario === 'late collision') {
        expect(foreignListener).toBe(true)
        expect(fetch).toHaveBeenCalledWith(
          'http://localhost:5175/admin/',
          expect.any(Object)
        )
        expect(
          mocks.spawn.mock.calls.some(
            ([, args]) =>
              args.includes('@nihongo/web') || args.includes('playwright')
          )
        ).toBe(false)
      }
      expect(mocks.cleanupDatabase).toHaveBeenCalledTimes(
        scenario === 'stop failure' ||
          scenario === 'Playwright and stop failure'
          ? 0
          : 1
      )
      if (scenario === 'Playwright and stop failure') {
        expect(aggregates).toEqual(
          expect.arrayContaining([
            [
              expect.objectContaining({ message: 'Owned process remains' }),
              expect.objectContaining({
                message: expect.stringContaining('withheld')
              })
            ],
            [
              expect.objectContaining({
                message: expect.stringContaining('exit 7')
              }),
              expect.any(originalAggregateError)
            ]
          ])
        )
      }
      if (
        scenario === 'SIGINT during Playwright' ||
        scenario === 'SIGTERM during Playwright'
      ) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(exit).toHaveBeenCalledWith(
          scenario === 'SIGINT during Playwright' ? 130 : 143
        )
        expect(mocks.stopOwnedProcesses).toHaveBeenCalledOnce()
      }
      if (success) {
        expect(lifecycle).toEqual([
          'database prepared',
          'actors prepared',
          'API spawned',
          'API ready',
          'admin spawned',
          'admin ready',
          'web spawned',
          'web ready',
          'Playwright spawned',
          'processes stopped',
          'database cleaned'
        ])
        const webCall = mocks.spawn.mock.calls.find(([, args]) =>
          args.includes('@nihongo/web')
        )
        expect(webCall?.[2].env).toMatchObject({
          NIHONGO_API_PROXY_TARGET: 'http://127.0.0.1:32123',
          VITE_API_MODE: mode
        })
        const playwrightCall = mocks.spawn.mock.calls.find(([, args]) =>
          args.includes('playwright')
        )
        expect(playwrightCall?.[2].env).toMatchObject({
          PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:32124',
          PHASE9_BROWSER_MODE: mode,
          PHASE9_BROWSER_FIXTURE: JSON.stringify(fixture)
        })
        expect(mocks.captureSnapshot).toHaveBeenCalledTimes(1)
        expect(mocks.assertDatabaseContract).toHaveBeenCalledTimes(1)
      }
      if (mocks.cleanupDatabase.mock.calls.length)
        expect(lifecycle.indexOf('database cleaned')).toBeGreaterThan(
          lifecycle.indexOf('processes stopped')
        )
      if (success) {
        expect(
          stdout.mock.calls.map(([value]) => String(value)).join('')
        ).toContain(`phase9.browser.${mode}.passed`)
        expect(
          stderr.mock.calls.map(([value]) => String(value)).join('')
        ).not.toContain(`phase9.browser.${mode}.failed`)
      } else {
        expect(
          stdout.mock.calls.map(([value]) => String(value)).join('')
        ).not.toContain(`phase9.browser.${mode}.passed`)
        expect(
          stderr.mock.calls.map(([value]) => String(value)).join('')
        ).toContain(`phase9.browser.${mode}.failed`)
      }
    }
  )
})
