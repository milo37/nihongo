const PG_CONCURRENT_QUERY_WARNING =
  'Calling client.query() when the client is already executing a query is deprecated'
const REQUIRED_TRACE_MARKERS = [
  'PgTransaction.performIO',
  'interpretNode',
  'Array.map'
] as const

export class IntegrationWarningBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrationWarningBudgetError'
  }
}

const countOccurrences = (source: string, pattern: string): number =>
  source.split(pattern).length - 1

const readWarningTraceBlocks = (output: string): string[] =>
  output
    .split(PG_CONCURRENT_QUERY_WARNING)
    .slice(1)
    .map((warningRemainder) => {
      const [, ...followingLines] = warningRemainder.split(/\r?\n/)
      const firstNonStackLine = followingLines.findIndex(
        (line) => !/^\s*at\b/.test(line)
      )
      return followingLines
        .slice(0, firstNonStackLine < 0 ? undefined : firstNonStackLine)
        .join('\n')
    })

const hasOrderedTraceMarkers = (traceBlock: string): boolean => {
  let previousIndex = -1
  return REQUIRED_TRACE_MARKERS.every((marker) => {
    const markerIndex = traceBlock.indexOf(marker, previousIndex + 1)
    if (markerIndex < 0) {
      return false
    }
    previousIndex = markerIndex
    return true
  })
}

export const assertIntegrationWarningBudget = (
  output: string,
  expectedCount: number
): void => {
  const observedCount = countOccurrences(output, PG_CONCURRENT_QUERY_WARNING)
  if (observedCount !== expectedCount) {
    throw new IntegrationWarningBudgetError(
      `Expected ${expectedCount} pg concurrent-query warnings, observed ${observedCount}.`
    )
  }

  readWarningTraceBlocks(output).forEach((traceBlock, index) => {
    if (!hasOrderedTraceMarkers(traceBlock)) {
      throw new IntegrationWarningBudgetError(
        `The pg warning trace ${index + 1} does not match the reviewed ordered stack.`
      )
    }
  })
}

export const assertSlice5IntegrationWarningBudget = (
  fullSuiteOutput: string,
  historicalPinOutput: string
): void => {
  assertIntegrationWarningBudget(fullSuiteOutput, 7)
  assertIntegrationWarningBudget(historicalPinOutput, 1)
}
