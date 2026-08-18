import { z } from 'zod'
import type { ApiEnvironment } from './env.js'

const practiceRuntimeEnvironmentSchema = z
  .object({
    runtime: z.enum(['v1-v2', 'v1-compatible']),
    authorityFile: z.string().min(1).optional()
  })
  .strict()
  .superRefine((environment, context) => {
    if (environment.runtime === 'v1-compatible' && !environment.authorityFile) {
      context.addIssue({
        code: 'custom',
        path: ['authorityFile'],
        message:
          'v1-compatible runtime은 외부 배포 authority record가 필요합니다.'
      })
    }
    if (environment.runtime === 'v1-v2' && environment.authorityFile) {
      context.addIssue({
        code: 'custom',
        path: ['authorityFile'],
        message:
          '외부 compatibility authority는 v1-compatible runtime에서만 사용할 수 있습니다.'
      })
    }
  })

export type PracticeRuntimeEnvironment = z.output<
  typeof practiceRuntimeEnvironmentSchema
>

export class PracticeRuntimeEnvironmentError extends Error {
  constructor() {
    super('Practice runtime environment validation failed.')
    this.name = 'PracticeRuntimeEnvironmentError'
  }
}

export const parsePracticeRuntimeEnvironment = (
  source: NodeJS.ProcessEnv,
  nodeEnvironment: ApiEnvironment['NODE_ENV']
): PracticeRuntimeEnvironment => {
  const parsed = practiceRuntimeEnvironmentSchema.safeParse({
    runtime:
      source.PRACTICE_CONTRACT_RUNTIME ??
      (nodeEnvironment === 'production' ? undefined : 'v1-v2'),
    authorityFile: source.PRACTICE_COMPATIBILITY_AUTHORITY_FILE
  })

  if (!parsed.success) {
    throw new PracticeRuntimeEnvironmentError()
  }
  return parsed.data
}
