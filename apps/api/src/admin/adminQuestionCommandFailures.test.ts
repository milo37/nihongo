import { describe, expect, it } from 'vitest'
import { mapTransactionError } from './adminQuestionCommandFailures.js'
import { AdminRuleViolation } from './adminRepositoryCommon.js'

describe('admin question command failures', () => {
  it('reports a split passage group publication as a validation error (#1196)', () => {
    const error = mapTransactionError(
      'publishQuestionVersion',
      new AdminRuleViolation(
        '23514',
        'A shared reading passage group must publish together.'
      )
    )
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      disposition: 'DEFINITE_ROLLBACK'
    })
  })
})
