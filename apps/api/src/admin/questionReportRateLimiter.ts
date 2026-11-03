import type { PrismaClient } from '../generated/prisma/client.js'
import {
  consumeRateLimitKeys,
  createRateLimitKey,
  type RateLimitPolicy
} from './keyedRateLimitStore.js'

export type QuestionReportRateLimitGroup = 'REPORT_ACTOR' | 'REPORT_VERSION'

type QuestionReportRateLimitInput =
  | {
      readonly actorId: string
      readonly clientIp: string
      readonly group: 'REPORT_ACTOR'
    }
  | {
      readonly group: 'REPORT_VERSION'
      readonly value: string
    }

export interface QuestionReportRateLimiter {
  readonly consume: (input: QuestionReportRateLimitInput) => Promise<void>
}

const policyByGroup = {
  REPORT_ACTOR: { limit: 5, windowMilliseconds: 10 * 60_000 },
  REPORT_VERSION: { limit: 20, windowMilliseconds: 60 * 60_000 }
} as const satisfies Readonly<
  Record<QuestionReportRateLimitGroup, RateLimitPolicy>
>

const settings = {
  storeUnavailableMessage: '문제 신고 제한 저장소에 연결할 수 없습니다.',
  stateInvalidMessage: '문제 신고 제한 상태를 확인할 수 없습니다.',
  rateLimitedMessage:
    '문제 신고 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  phase7Disposition: 'NO_TX'
} as const

export const createQuestionReportRateLimiter = ({
  client,
  keySecret
}: {
  readonly client: Pick<PrismaClient, '$queryRaw'>
  readonly keySecret: string
}): QuestionReportRateLimiter => ({
  consume: (input) => {
    const { group } = input
    const keys =
      input.group === 'REPORT_ACTOR'
        ? [
            createRateLimitKey({
              dimension: 'ACTOR',
              group,
              keySecret,
              value: input.actorId
            }),
            createRateLimitKey({
              dimension: 'IP',
              group,
              keySecret,
              value: input.clientIp
            })
          ]
        : [
            createRateLimitKey({
              dimension: 'VERSION',
              group,
              keySecret,
              value: input.value
            })
          ]
    return consumeRateLimitKeys({
      client,
      keys,
      policy: policyByGroup[group],
      settings
    })
  }
})
