import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZodError } from 'zod'
import { ArtifactReadError } from './validators/v1/artifactReader.js'
import { canonicalJsonBytes } from './validators/v1/canonicalHash.js'
import { StrictJsonError } from './validators/v1/strictJson.js'
import {
  ContentAnalysisError,
  isContentAnalysisCommand,
  MAX_ANALYSIS_OUTPUT_BYTES
} from './commands/v1/commandSupport.js'
import { runContentAnalysis } from './commands/v1/commands.js'

export const runContentAnalysisCli = async (
  argv: readonly string[]
): Promise<void> => {
  try {
    const [command, ...args] = argv
    if (!isContentAnalysisCommand(command))
      throw new ContentAnalysisError('CONTENT_COMMAND_UNKNOWN')
    const result = await runContentAnalysis(command, args)
    const bytes = canonicalJsonBytes(result)
    if (bytes.byteLength + 1 > MAX_ANALYSIS_OUTPUT_BYTES)
      throw new ContentAnalysisError('CONTENT_OUTPUT_TOO_LARGE')
    process.stdout.write(Buffer.concat([bytes, Buffer.from('\n')]))
  } catch (error: unknown) {
    const code =
      error instanceof ContentAnalysisError
        ? error.code
        : error instanceof ArtifactReadError ||
            error instanceof StrictJsonError ||
            error instanceof ZodError
          ? 'CONTENT_INPUT_INVALID'
          : 'CONTENT_ANALYSIS_FAILED'
    process.stderr.write(
      `${JSON.stringify({ schemaVersion: 1, mode: 'PASSIVE_ANALYSIS', status: 'ERROR', code })}\n`
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runContentAnalysisCli(process.argv.slice(2))
}
