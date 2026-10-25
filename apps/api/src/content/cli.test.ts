import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runContentAnalysisCli } from './cli.js'
import {
  ContentAnalysisError,
  MAX_ANALYSIS_OUTPUT_BYTES
} from './commands/v1/commandSupport.js'
import { runContentAnalysis } from './commands/v1/commands.js'

vi.mock('./commands/v1/commands.js', () => ({ runContentAnalysis: vi.fn() }))

const priorExitCode = process.exitCode
const result = {
  schemaVersion: 1 as const,
  mode: 'PASSIVE_ANALYSIS' as const,
  command: 'content:validate',
  status: 'ANALYZED' as const,
  scope: 'BUNDLE_ONLY' as const,
  inputSha256: 'a'.repeat(64),
  itemCount: 1,
  inventory: null,
  trustVerified: false as const,
  fullTaxonomyApplicabilityVerified: false as const,
  structurallyValid: true as const
}
let stdout = ''
let stderr = ''
beforeEach(() => {
  vi.resetAllMocks()
  stdout = ''
  stderr = ''
  process.exitCode = undefined
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => {
    stdout += String(value)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
    stderr += String(value)
    return true
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = priorExitCode
})

describe('passive content CLI', () => {
  it.each(['check', 'validate', 'coverage', 'duplicates'])(
    'dispatches only supported verb %s and prints passive metadata',
    async (command) => {
      vi.mocked(runContentAnalysis).mockResolvedValue({
        ...result,
        command: `content:${command}`
      })
      await runContentAnalysisCli([command])
      expect(runContentAnalysis).toHaveBeenCalledWith(command, [])
      expect(JSON.parse(stdout)).toMatchObject({
        mode: 'PASSIVE_ANALYSIS',
        status: 'ANALYZED',
        trustVerified: false
      })
      expect(stderr).toBe('')
      expect(process.exitCode).toBeUndefined()
    }
  )

  it.each([
    undefined,
    'unknown',
    'review-check',
    'author-prepare',
    'review-prepare',
    'legacy-policy-prepare',
    'legacy-policy-finalize',
    'policy-prepare',
    'policy-finalize',
    'policy-activation-prepare',
    'policy-activation-finalize'
  ])(
    'rejects excluded/unknown verb %s before handler invocation',
    async (command) => {
      await runContentAnalysisCli(command === undefined ? [] : [command])
      expect(runContentAnalysis).not.toHaveBeenCalled()
      expect(stdout).toBe('')
      expect(JSON.parse(stderr)).toMatchObject({
        code: 'CONTENT_COMMAND_UNKNOWN',
        mode: 'PASSIVE_ANALYSIS'
      })
      expect(process.exitCode).toBe(1)
    }
  )

  it('passes strict argv to the handler without adding policy or runtime inputs', async () => {
    vi.mocked(runContentAnalysis).mockResolvedValue(result)
    await runContentAnalysisCli([
      'validate',
      '--bundle',
      'content/fixture.json'
    ])
    expect(runContentAnalysis).toHaveBeenCalledWith('validate', [
      '--bundle',
      'content/fixture.json'
    ])
  })

  it('does not report success before input analysis completes', async () => {
    let complete: ((value: typeof result) => void) | undefined
    vi.mocked(runContentAnalysis).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      })
    )
    const running = runContentAnalysisCli(['validate'])
    expect(stdout).toBe('')
    if (!complete) throw new Error('Missing resolver')
    complete(result)
    await running
    expect(JSON.parse(stdout)).toMatchObject({ status: 'ANALYZED' })
  })

  it('keeps raw errors, source text, paths and misleading error names off both streams', async () => {
    const error = new Error(
      '/private/CANARY_SECRET_PATH raw-question-CANARY_SECRET_TEXT'
    )
    error.name = 'CANARY_SECRET_NAME'
    vi.mocked(runContentAnalysis).mockRejectedValue(error)
    await runContentAnalysisCli(['validate'])
    expect(stdout).toBe('')
    expect(stderr).not.toContain('CANARY')
    expect(JSON.parse(stderr).code).toBe('CONTENT_ANALYSIS_FAILED')
    expect(process.exitCode).toBe(1)
  })

  it('emits only an owned failure code for rejected arguments', async () => {
    vi.mocked(runContentAnalysis).mockRejectedValue(
      new ContentAnalysisError('CONTENT_ARGUMENT_INVALID')
    )
    await runContentAnalysisCli(['coverage', '--target', '400'])
    expect(JSON.parse(stderr).code).toBe('CONTENT_ARGUMENT_INVALID')
    expect(stdout).toBe('')
    expect(process.exitCode).toBe(1)
  })

  it('rejects oversized output before any success bytes are written', async () => {
    vi.mocked(runContentAnalysis).mockResolvedValue({
      ...result,
      inputSha256: 'a'.repeat(MAX_ANALYSIS_OUTPUT_BYTES)
    })
    await runContentAnalysisCli(['validate'])
    expect(stdout).toBe('')
    expect(JSON.parse(stderr).code).toBe('CONTENT_OUTPUT_TOO_LARGE')
    expect(process.exitCode).toBe(1)
  })
})
