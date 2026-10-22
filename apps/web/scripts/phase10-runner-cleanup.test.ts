import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  createServer: vi.fn(),
  stopOwnedProcesses: vi.fn(),
  retireOwnedProcess: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:net', () => ({ createServer: mocks.createServer }))
vi.mock('../../../apps/api/src/e2e/ownedProcessGroup.js', () => ({
  shouldDetachOwnedProcess: false,
  stopOwnedProcesses: mocks.stopOwnedProcesses,
  retireOwnedProcess: mocks.retireOwnedProcess
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
    pid: undefined
  }) as unknown as ChildProcess

const finish = (child: ChildProcess, outcome: ChildOutcome): void => {
  Object.assign(child, { exitCode: outcome.code, signalCode: outcome.signal })
  child.emit('close', outcome.code, outcome.signal)
}

describe('Phase10 real parent cleanup result', () => {
  const originalArgv = process.argv
  const originalExitCode = process.exitCode
  let originalSignalListeners: Map<
    NodeJS.Signals,
    ((signal: NodeJS.Signals) => void)[]
  >

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
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
})
