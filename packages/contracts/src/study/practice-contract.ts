import { z } from 'zod'
import { opaqueIdSchema } from '../common/id.js'

export const practiceContractV2HeadersSchema = z
  .object({
    'x-nihongo-practice-contract': z.literal('2')
  })
  .strict()

export const idempotentPracticeContractV2HeadersSchema =
  practiceContractV2HeadersSchema
    .extend({
      'idempotency-key': opaqueIdSchema
    })
    .strict()

export const practiceContractResponseHeadersSchema = z
  .object({
    'x-nihongo-practice-contract': z.enum(['1', '2'])
  })
  .strict()

export type PracticeContractV2Headers = z.input<
  typeof practiceContractV2HeadersSchema
>
export type IdempotentPracticeContractV2Headers = z.input<
  typeof idempotentPracticeContractV2HeadersSchema
>
export type PracticeContractResponseHeaders = z.output<
  typeof practiceContractResponseHeadersSchema
>
