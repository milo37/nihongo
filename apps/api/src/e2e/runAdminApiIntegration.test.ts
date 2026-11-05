import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

const database = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn()
}))
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))
vi.mock('pg', () => ({
  Client: class {
    connect = database.connect
    query = database.query
    end = database.end
  }
}))

let register: typeof import('./runAdminApiIntegration.js').registerDatabaseCapabilityForTest
let prepareArtifacts: typeof import('./runAdminApiIntegration.js').prepareIntegrationArtifacts
let seedInvocation: typeof import('./runAdminApiIntegration.js').adminSeedInvocation
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('API_INTEGRATION_CASE', undefined)
  vi.stubEnv(
    'API_INTEGRATION_DATABASE_URL',
    'postgresql://synthetic:synthetic@127.0.0.1:5432/nihongo_test'
  )
  register = (await import('./runAdminApiIntegration.js'))
    .registerDatabaseCapabilityForTest
  prepareArtifacts = (await import('./runAdminApiIntegration.js'))
    .prepareIntegrationArtifacts
  seedInvocation = (await import('./runAdminApiIntegration.js'))
    .adminSeedInvocation
})
afterAll(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.resetAllMocks()
  database.query.mockResolvedValue({ rows: [], rowCount: 1 })
})

const callsContaining = (name: string) =>
  database.query.mock.calls.filter(
    ([sql]) => typeof sql === 'string' && sql.includes(name)
  )

// #504 P8-1: the baseline has no issuer activation; the runner registers the
// capability row only.
describe('API database capability registration without a database', () => {
  it('registers the capability row once as the migration login and closes', async () => {
    await register()
    expect(callsContaining('INSERT INTO "DatabaseCapability"')).toHaveLength(1)
    expect(callsContaining('activate_v1_issuer')).toHaveLength(0)
    expect(database.connect).toHaveBeenCalledTimes(1)
    expect(database.end).toHaveBeenCalledTimes(1)
  })
  it('fails closed when the capability row does not match the target and still closes', async () => {
    database.query.mockResolvedValue({ rows: [], rowCount: 0 })
    await expect(register()).rejects.toThrow(
      'Database capability does not match the safe target.'
    )
    expect(database.end).toHaveBeenCalledTimes(1)
  })
  it('honors an already aborted operation before opening a connection', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(register(controller.signal)).rejects.toBeDefined()
    expect(database.connect).not.toHaveBeenCalled()
    expect(database.query).not.toHaveBeenCalled()
    expect(database.end).not.toHaveBeenCalled()
  })
})

describe('shared API integration artifacts without a database', () => {
  let taskTemp: string
  let previousRunId: string | undefined
  let previousRunnerTemp: string | undefined
  beforeEach(() => {
    taskTemp = mkdtempSync(join(tmpdir(), 'nihongo-api-preparation-'))
    previousRunId = process.env.GITHUB_RUN_ID
    previousRunnerTemp = process.env.RUNNER_TEMP
    delete process.env.GITHUB_RUN_ID
    process.env.RUNNER_TEMP = taskTemp
  })
  afterEach(() => {
    if (previousRunId === undefined) delete process.env.GITHUB_RUN_ID
    else process.env.GITHUB_RUN_ID = previousRunId
    if (previousRunnerTemp === undefined) delete process.env.RUNNER_TEMP
    else process.env.RUNNER_TEMP = previousRunnerTemp
    rmSync(taskTemp, { recursive: true, force: true })
  })
  it('prepares all required artifacts in dependency order for standalone execution', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const environment = { NODE_ENV: 'test' }
    await prepareArtifacts({ environment, run })
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['pnpm', ['--filter', '@nihongo/contracts', 'run', 'build']],
      ['pnpm', ['--filter', '@nihongo/domain', 'run', 'build']],
      ['pnpm', ['--filter', '@nihongo/api', 'run', 'db:generate']]
    ])
    expect(run.mock.calls.every(([, , env]) => env === environment)).toBe(true)
    expect(database.connect).not.toHaveBeenCalled()
  })

  it('reuses artifacts explicitly prepared by the parent without database preparation', async () => {
    const run = vi.fn()
    await prepareArtifacts({ prepared: true, run })
    expect(run).not.toHaveBeenCalled()
    expect(database.connect).not.toHaveBeenCalled()
    expect(database.query).not.toHaveBeenCalled()
  })

  it('propagates preparation failure before starting the next command', async () => {
    const failure = new Error('synthetic compilation failure')
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)
    await expect(prepareArtifacts({ run })).rejects.toBe(failure)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('honors cancellation before starting another preparation command', async () => {
    const controller = new AbortController()
    const run = vi.fn(async () => {
      controller.abort()
    })
    await expect(
      prepareArtifacts({ run, abortSignal: controller.signal })
    ).rejects.toBeDefined()
    expect(run).toHaveBeenCalledTimes(1)
    await expect(
      prepareArtifacts({ run, prepared: true, abortSignal: controller.signal })
    ).rejects.toBeDefined()
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('browser-prepared seed invocation', () => {
  it('keeps standalone seed generation and test-target defaults', () => {
    expect(seedInvocation(false)).toEqual({
      args: ['--filter', '@nihongo/api', 'run', 'db:seed:test'],
      environment: {}
    })
  })
  it('reuses generated artifacts while explicitly selecting the same test seed', () => {
    expect(seedInvocation(true)).toEqual({
      args: ['--filter', '@nihongo/api', 'exec', 'tsx', 'prisma/seed.ts'],
      environment: { SEED_TARGET: 'test' }
    })
  })
})
