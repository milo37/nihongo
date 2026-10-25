import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnedProcess } from './ownedProcessGroup.js'

const ports = vi.hoisted(() => ({
  spawn: vi.fn(),
  stop: vi.fn(),
  retire: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn()
}))
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))
vi.mock('pg', () => ({
  Client: class {
    connect = ports.connect
    query = ports.query
    end = ports.end
  }
}))
vi.mock('node:child_process', () => ({ spawn: ports.spawn }))
vi.mock('./ownedProcessGroup.js', () => ({
  shouldDetachOwnedProcess: true,
  stopOwnedProcesses: ports.stop,
  retireOwnedProcess: ports.retire
}))
vi.mock('./validatePhase10ApiIntegrationManifest.js', () => ({
  validatePhase10ApiIntegrationManifest: async () => undefined
}))
vi.mock('./phase10ApiIntegrationManifest.js', () => ({
  getPhase10ApiIntegrationEntriesByOwner: () => [
    { shard: 'process-only', connectionRole: 'none' }
  ]
}))

const signals = ['SIGINT', 'SIGTERM'] as const
type CommandChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  closed: boolean
}
let children: CommandChild[]
let stopped: OwnedProcess['child'][]
let finishCommands: boolean
let failCommand: number | undefined
let listenersBefore: Map<string, Set<unknown>>
let initialExitCode: typeof process.exitCode
let initialArgv: string[]

const close = (child: CommandChild, code: number): void => {
  if (child.closed) return
  child.closed = true
  child.emit('close', code, null)
}
const start = async (): Promise<void> => {
  await import('./runPhase10ApiIntegration.js')
  await vi.waitFor(() => expect(ports.spawn).toHaveBeenCalled())
}
const signalParent = (signal: (typeof signals)[number]): void => {
  const listener = process
    .listeners(signal)
    .find((candidate) => !listenersBefore.get(signal)?.has(candidate))
  expect(listener).toBeTypeOf('function')
  listener?.(signal)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHASE7_API_INTEGRATION_CASE', undefined)
  vi.stubEnv(
    'PHASE7_API_INTEGRATION_DATABASE_URL',
    'postgresql://synthetic:synthetic@127.0.0.1:5432/nihongo_test'
  )
  initialExitCode = process.exitCode
  initialArgv = process.argv
  process.argv = [process.execPath, 'vitest']
  listenersBefore = new Map(
    signals.map((signal) => [
      signal,
      new Set<unknown>(process.listeners(signal))
    ])
  )
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  children = []
  stopped = []
  finishCommands = false
  failCommand = undefined
  ports.spawn.mockImplementation((_command, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      closed: false
    })
    children.push(child)
    if (finishCommands) {
      const ordinal = children.length
      queueMicrotask(() => {
        if (args.some((arg) => arg.startsWith('--shard='))) {
          child.stdout.emit(
            'data',
            JSON.stringify({
              event: 'phase10.api_integration.shard.passed',
              shard: 'process-only',
              executedFileCount: 1,
              passedTestCount: 1,
              schemaName: null,
              schemaRemoved: false
            }) + '\n'
          )
        }
        close(child, ordinal === failCommand ? 7 : 0)
      })
    }
    return child
  })
  ports.retire.mockImplementation(
    async (owned: OwnedProcess[], command: OwnedProcess) => {
      const index = owned.indexOf(command)
      if (index !== -1) owned.splice(index, 1)
    }
  )
  ports.stop.mockImplementation(async (owned: readonly OwnedProcess[]) => {
    stopped.push(...owned.map(({ child }) => child))
    // A graceful command can exit zero on cancellation; no later prep may run.
    owned.forEach(({ child }) => close(child as unknown as CommandChild, 0))
  })
})

afterEach(async () => {
  children.forEach((child) => close(child, 1))
  await new Promise<void>((resolve) => setImmediate(resolve))
  for (const signal of signals) {
    for (const listener of process.listeners(signal)) {
      if (!listenersBefore.get(signal)?.has(listener))
        process.removeListener(signal, listener)
    }
  }
  process.exitCode = initialExitCode
  process.argv = initialArgv
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Phase10 parent common preparation ownership without a database', () => {
  it.each(signals)(
    '%s stops in-flight prep and prevents the next prep/shard',
    async (signal) => {
      await start()
      signalParent(signal)
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalled())
      expect(stopped).toEqual([children[0]])
      expect(ports.spawn).toHaveBeenCalledTimes(1)
      expect(ports.connect).not.toHaveBeenCalled()
      expect(process.exit).toHaveBeenCalledWith(signal === 'SIGINT' ? 130 : 143)
    }
  )

  it('keeps a middle preparation failure nonzero in the parent cleanup owner', async () => {
    finishCommands = true
    failCommand = 2
    await start()
    await vi.waitFor(() => expect(process.exitCode).toBe(1))
    expect(ports.spawn).toHaveBeenCalledTimes(2)
    const owner = ports.stop.mock.calls[0]?.[0]
    expect(owner).toBeDefined()
    expect(ports.retire.mock.calls.every(([owned]) => owned === owner)).toBe(
      true
    )
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('phase10.api_integration.failed')
    )
  })

  it('keeps a signal cleanup failure nonzero', async () => {
    ports.stop.mockRejectedValueOnce(new Error('synthetic stop failure'))
    await start()
    signalParent('SIGTERM')
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1))
    expect(ports.stop.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ child: children[0] })
    ])
    expect(ports.spawn).toHaveBeenCalledTimes(1)
  })

  it('prepares contracts/domain/Prisma once before the prepared shard child', async () => {
    finishCommands = true
    await start()
    await vi.waitFor(() =>
      expect(process.stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('phase10.api_integration.current.passed')
      )
    )
    expect(ports.spawn.mock.calls.map(([, args]) => args)).toEqual([
      ['run', 'build:contracts'],
      ['run', 'build:domain'],
      ['--filter', '@nihongo/api', 'run', 'db:generate'],
      [
        '--filter',
        '@nihongo/api',
        'exec',
        'tsx',
        'src/e2e/runPhase10ApiIntegration.ts',
        '--shard=process-only',
        '--artifacts-prepared'
      ]
    ])
    expect(ports.connect).not.toHaveBeenCalled()
  })
})
