import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const supportedCommands = new Set([
  'check',
  'validate',
  'coverage',
  'duplicates'
])
const fail = (code) => {
  process.stderr.write(
    `${JSON.stringify({ schemaVersion: 1, mode: 'PASSIVE_ANALYSIS', status: 'ERROR', code })}\n`
  )
  process.exitCode = 1
}

if (!supportedCommands.has(argv[0])) {
  fail('CONTENT_COMMAND_UNKNOWN')
} else {
  try {
    const requireApi = createRequire(
      new URL('../../apps/api/package.json', import.meta.url)
    )
    const { tsImport } = await import(
      pathToFileURL(requireApi.resolve('tsx/esm/api')).href
    )
    const { runContentAnalysisCli } = await tsImport(
      new URL('../../apps/api/src/content/cli.ts', import.meta.url).href,
      import.meta.url
    )
    await runContentAnalysisCli(argv)
  } catch {
    fail('CONTENT_ANALYSIS_FAILED')
  }
}
