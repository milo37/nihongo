import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnedProcess } from './ownedProcessGroup.js'

const ports = vi.hoisted(() => ({
  spawn: vi.fn(),
  stop: vi.fn(),
  retire: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  prepareDatabase: vi.fn(),
  cleanupDatabase: vi.fn(),
  executeEntry: vi.fn(),
  databaseShard: false
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
vi.mock('./runAdminApiIntegration.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./runAdminApiIntegration.js')>()
  return {
    ...actual,
    preparePhase7IsolatedDatabase: ports.prepareDatabase,
    cleanupPhase7IsolatedDatabase: ports.cleanupDatabase
  }
})
vi.mock('./apiIntegrationExecution.js', () => ({
  runApiIntegrationManifestVitestFile: ports.executeEntry
}))

vi.mock('./ownedProcessGroup.js', () => ({
  shouldDetachOwnedProcess: true,
  stopOwnedProcesses: ports.stop,
  retireOwnedProcess: ports.retire
}))
vi.mock('./validateApiIntegrationManifest.js', () => ({
  validateApiIntegrationManifest: async () => undefined
}))
vi.mock('./apiIntegrationManifest.js', () => ({
  getApiIntegrationEntriesByOwner: () => [
    {
      path: 'src/question/questionCatalog.integration.test.ts',
      executionOwner: 'phase10',
      shard: ports.databaseShard ? 'db-preparation' : 'process-only',
      order: 1,
      databaseState: ports.databaseShard ? 'test-current' : 'none',
      connectionRole: ports.databaseShard ? 'application' : 'none',
      requiredEnvironment: [],
      seedPolicy: 'none',
      isolation: 'test-process'
    }
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
let taskTemp: string

const close = (child: CommandChild, code: number): void => {
  if (child.closed) return
  child.closed = true
  child.emit('close', code, null)
}
const start = async (): Promise<void> => {
  await import('./runApiIntegration.js')
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
  taskTemp = mkdtempSync(join(tmpdir(), 'nihongo-phase10-preparation-'))
  vi.stubEnv('RUNNER_TEMP', taskTemp)
  vi.stubEnv('GITHUB_RUN_ID', undefined)
  ports.databaseShard = false
  ports.prepareDatabase.mockReset()
  ports.cleanupDatabase.mockReset().mockResolvedValue(undefined)
  ports.executeEntry.mockReset().mockResolvedValue(1)
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
  rmSync(taskTemp, { recursive: true, force: true })
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
      ['--filter', '@nihongo/contracts', 'run', 'build'],
      ['--filter', '@nihongo/domain', 'run', 'build'],
      ['--filter', '@nihongo/api', 'run', 'db:generate'],
      [
        '--filter',
        '@nihongo/api',
        'exec',
        'tsx',
        'src/e2e/runApiIntegration.ts',
        '--shard=process-only',
        '--artifacts-prepared'
      ]
    ])
    expect(ports.connect).not.toHaveBeenCalled()
  })
})

describe('Phase10 partial database preparation cleanup without a database', () => {
  it.each([false, true])(
    'cleans a failed preparation and preserves nonzero failure (cleanupFails=%s)',
    async (cleanupFails) => {
      ports.databaseShard = true
      process.argv.push('--shard=db-preparation', '--artifacts-prepared')
      ports.prepareDatabase.mockRejectedValue(
        new Error('synthetic partial DB preparation failure')
      )
      if (cleanupFails)
        ports.cleanupDatabase.mockRejectedValue(
          new Error('synthetic partial cleanup failure')
        )
      await import('./runApiIntegration.js')
      await vi.waitFor(() => expect(process.exitCode).toBe(1))
      expect(ports.prepareDatabase).toHaveBeenCalledOnce()
      expect(ports.prepareDatabase).toHaveBeenCalledWith(
        expect.objectContaining({ seedRuns: 0, artifactsPrepared: true })
      )
      expect(ports.cleanupDatabase).toHaveBeenCalledOnce()
      expect(ports.executeEntry).not.toHaveBeenCalled()
      expect(ports.connect).not.toHaveBeenCalled()
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('synthetic partial DB preparation failure')
      )
      if (cleanupFails)
        expect(process.stderr.write).toHaveBeenCalledWith(
          expect.stringContaining('phase10.api_integration.cleanup_failed')
        )
    }
  )

  it('does not arm database cleanup for a process-only shard', async () => {
    process.argv.push('--shard=process-only')
    await import('./runApiIntegration.js')
    await vi.waitFor(() =>
      expect(process.stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('phase10.api_integration.shard.passed')
      )
    )
    expect(ports.prepareDatabase).not.toHaveBeenCalled()
    expect(ports.cleanupDatabase).not.toHaveBeenCalled()
    expect(ports.executeEntry).toHaveBeenCalledOnce()
    expect(ports.connect).not.toHaveBeenCalled()
  })
})
