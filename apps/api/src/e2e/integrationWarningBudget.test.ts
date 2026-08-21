import { describe, expect, it } from 'vitest'
import {
  assertIntegrationWarningBudget,
  assertSlice5IntegrationWarningBudget,
  IntegrationWarningBudgetError
} from './integrationWarningBudget.js'

const warning =
  'Calling client.query() when the client is already executing a query is deprecated'
const trace = [
  warning,
  'at PgTransaction.performIO (adapter.js:1:1)',
  'at e.interpretNode (client.js:1:1)',
  'at Array.map (<anonymous>)'
].join('\n')

describe('integration warning budget', () => {
  it('accepts only the exact warning count and reviewed stack signature', () => {
    expect(() =>
      assertIntegrationWarningBudget(`${trace}\n${trace}`, 2)
    ).not.toThrow()
  })

  it('rejects count and stack drift', () => {
    expect(() => assertIntegrationWarningBudget(trace, 2)).toThrow(
      IntegrationWarningBudgetError
    )
    expect(() =>
      assertIntegrationWarningBudget(`${warning}\n${warning}`, 2)
    ).toThrow('ordered stack')
    expect(() =>
      assertIntegrationWarningBudget(
        `${trace}\n${warning}\nat unrelatedStack (other.js:1:1)`,
        2
      )
    ).toThrow('trace 2')
    expect(() =>
      assertIntegrationWarningBudget(
        [
          warning,
          'at Array.map (<anonymous>)',
          'at e.interpretNode (client.js:1:1)',
          'at PgTransaction.performIO (adapter.js:1:1)'
        ].join('\n'),
        1
      )
    ).toThrow('ordered stack')
    expect(() =>
      assertIntegrationWarningBudget(
        [
          warning,
          'reporter output ended the warning stack',
          'at PgTransaction.performIO (adapter.js:1:1)',
          'at e.interpretNode (client.js:1:1)',
          'at Array.map (<anonymous>)'
        ].join('\n'),
        1
      )
    ).toThrow('ordered stack')
  })

  it('locks the Slice 5 full and historical warning distribution', () => {
    const fullSuite = Array.from({ length: 7 }, () => trace).join('\n')

    expect(() =>
      assertSlice5IntegrationWarningBudget(fullSuite, trace)
    ).not.toThrow()
    expect(() =>
      assertSlice5IntegrationWarningBudget(
        Array.from({ length: 6 }, () => trace).join('\n'),
        `${trace}\n${trace}`
      )
    ).toThrow('Expected 7')
  })
})
