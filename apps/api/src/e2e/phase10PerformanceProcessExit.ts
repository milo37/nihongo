import { writeSync } from 'node:fs'

export interface Phase10PerformanceTerminalRecord {
  readonly destination: 'stderr' | 'stdout'
  readonly value: Readonly<Record<string, unknown>>
}

interface ExitPhase10PerformanceProcessOptions {
  readonly exitCode: number
  readonly records: readonly Phase10PerformanceTerminalRecord[]
}

export const exitPhase10PerformanceProcess = ({
  exitCode,
  records
}: ExitPhase10PerformanceProcessOptions): never => {
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
