import { describe, expect, it } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { ApiEnvironment } from '../config/env.js'
import type { StructuredLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { StudySessionService } from '../study/studySessionService.js'
import { ApplicationError } from '../errors/applicationError.js'
import {
  assertAccountNotRestricted,
  unrestrictedAccountReader
} from './accountRestriction.js'

type Dependencies = Parameters<typeof createApiApp>[0]

const base = (nodeEnvironment: string): Dependencies =>
  ({
    auth: {
      environment: { NODE_ENV: nodeEnvironment } as unknown as ApiEnvironment
    },
    checkReadiness: async () => undefined,
    logger: {} as StructuredLogger,
    questionReader: {} as QuestionReader,
    study: {
      practiceContractV2Enabled: true,
      service: {} as StudySessionService
    }
  }) as unknown as Dependencies

describe('account restriction wiring', () => {
  it('refuses to build production learner routes without a reader', () => {
    expect(() => createApiApp(base('production'))).toThrow(
      'Production learner routes require an account restriction reader.'
    )
  })

  it('throws ACCOUNT_RESTRICTED only for a restricted member', async () => {
    await expect(
      assertAccountNotRestricted(unrestrictedAccountReader, 'member')
    ).resolves.toBeUndefined()
    const error = await assertAccountNotRestricted(
      { isRestricted: async () => true },
      'member'
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApplicationError)
    expect(error).toMatchObject({
      code: 'ACCOUNT_RESTRICTED',
      retryable: false
    })
  })
})
