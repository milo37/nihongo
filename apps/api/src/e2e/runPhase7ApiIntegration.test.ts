import {
  afterAll,
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

let register: typeof import('./runPhase7ApiIntegration.js').registerCapabilityAndActivate
let prepareArtifacts: typeof import('./runPhase7ApiIntegration.js').preparePhase7IntegrationArtifacts
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHASE7_API_INTEGRATION_CASE', undefined)
  vi.stubEnv(
    'PHASE7_API_INTEGRATION_DATABASE_URL',
    'postgresql://synthetic:synthetic@127.0.0.1:5432/nihongo_test'
  )
  register = (await import('./runPhase7ApiIntegration.js'))
    .registerCapabilityAndActivate
  prepareArtifacts = (await import('./runPhase7ApiIntegration.js'))
    .preparePhase7IntegrationArtifacts
})
afterAll(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.resetAllMocks()
  database.query.mockResolvedValue({
    rows: [
      {
        databaseName: 'nihongo_test',
        serverAddress: '127.0.0.1',
        serverPort: 5432
      }
    ]
  })
})

const callsContaining = (name: string) =>
  database.query.mock.calls.filter(
    ([sql]) => typeof sql === 'string' && sql.includes(name)
  )

describe('Phase 7 API issuer activation ownership without a database', () => {
  it('keeps default API/browser preparation registration and activation', async () => {
    await register()
    expect(callsContaining('phase7_register_database_capability')).toHaveLength(
      1
    )
    expect(callsContaining('phase7_activate_v1_issuer')).toHaveLength(1)
    expect(database.connect).toHaveBeenCalledTimes(1)
    expect(database.end).toHaveBeenCalledTimes(1)
  })
  it('keeps explicit runner activation', async () => {
    await register(undefined, 'runner')
    expect(callsContaining('phase7_activate_v1_issuer')).toHaveLength(1)
  })
  it('registers the capability but defers lifecycle activation to its existing fixture', async () => {
    await register(undefined, 'fixture')
    expect(callsContaining('current_database()')).toHaveLength(1)
    expect(callsContaining('phase7_register_database_capability')).toHaveLength(
      1
    )
    expect(callsContaining('phase7_activate_v1_issuer')).toHaveLength(0)
    expect(database.connect).toHaveBeenCalledTimes(1)
    expect(database.end).toHaveBeenCalledTimes(1)
  })
  it('fails closed on absent endpoint identity and closes the connection', async () => {
    database.query.mockResolvedValue({ rows: [] })
    await expect(register(undefined, 'fixture')).rejects.toThrow(
      'Phase 7 API endpoint identity is unavailable.'
    )
    expect(callsContaining('phase7_register_database_capability')).toHaveLength(
      0
    )
    expect(callsContaining('phase7_activate_v1_issuer')).toHaveLength(0)
    expect(database.end).toHaveBeenCalledTimes(1)
  })
  it('propagates registration failure without activating and still closes', async () => {
    const failure = new Error('synthetic registration failure')
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes('phase7_register_database_capability')) throw failure
      return {
        rows: [
          {
            databaseName: 'nihongo_test',
            serverAddress: '127.0.0.1',
            serverPort: 5432
          }
        ]
      }
    })
    await expect(register(undefined, 'fixture')).rejects.toBe(failure)
    expect(callsContaining('phase7_activate_v1_issuer')).toHaveLength(0)
    expect(database.end).toHaveBeenCalledTimes(1)
  })
  it('preserves the one-way activation failure and closes for runner ownership', async () => {
    const failure = new Error('synthetic one-way guard failure')
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes('phase7_activate_v1_issuer')) throw failure
      return {
        rows: [
          {
            databaseName: 'nihongo_test',
            serverAddress: '127.0.0.1',
            serverPort: 5432
          }
        ]
      }
    })
    await expect(register()).rejects.toBe(failure)
    expect(database.end).toHaveBeenCalledTimes(1)
  })
  it('honors an already aborted operation before opening a connection', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(register(controller.signal, 'fixture')).rejects.toBeDefined()
    expect(database.connect).not.toHaveBeenCalled()
    expect(database.query).not.toHaveBeenCalled()
    expect(database.end).not.toHaveBeenCalled()
  })
})

describe('shared API integration artifacts without a database', () => {
  it('prepares all required artifacts in dependency order for standalone execution', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const environment = { NODE_ENV: 'test' }
    await prepareArtifacts({ environment, run })
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['pnpm', ['run', 'build:contracts']],
      ['pnpm', ['run', 'build:domain']],
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
