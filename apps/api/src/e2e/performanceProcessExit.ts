import { writeSync } from 'node:fs'

export interface PerformanceTerminalRecord {
  readonly destination: 'stderr' | 'stdout'
  readonly value: Readonly<Record<string, unknown>>
}

interface ExitPerformanceProcessOptions {
  readonly exitCode: number
  readonly records: readonly PerformanceTerminalRecord[]
}

export const exitPerformanceProcess = ({
  exitCode,
  records
}: ExitPerformanceProcessOptions): never => {
  let terminalExitCode = exitCode
  try {
    for (const record of records) {
      const fileDescriptor = record.destination === 'stdout' ? 1 : 2
      writeSync(fileDescriptor, `${JSON.stringify(record.value)}\n`)
    }
  } catch {
    terminalExitCode = 1
  } finally {
    process.exit(terminalExitCode)
  }
}
