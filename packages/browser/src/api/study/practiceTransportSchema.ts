import { z } from 'zod'

type PracticeTransportHeaders = z.output<typeof practiceTransportHeadersSchema>

export const refinePracticeJsonTransportHeaders = (
  headers: PracticeTransportHeaders,
  context: z.RefinementCtx,
  allowReplay: boolean
): void => {
  if (!headers['content-type']?.toLowerCase().startsWith('application/json')) {
    context.addIssue({
      code: 'custom',
      path: ['headers', 'content-type'],
      message: 'JSON 응답에는 application/json Content-Type이 필요합니다.'
    })
  }
  if (!allowReplay && headers['idempotency-replayed'] !== null) {
    context.addIssue({
      code: 'custom',
      path: ['headers', 'idempotency-replayed'],
      message: '이 응답에는 replay header가 없어야 합니다.'
    })
  }
  if (headers.location !== null) {
    context.addIssue({
      code: 'custom',
      path: ['headers', 'location'],
      message: '성공 응답에는 Location header가 없어야 합니다.'
    })
  }
}

export const refinePracticeNoContentTransportHeaders = (
  headers: PracticeTransportHeaders,
  context: z.RefinementCtx
): void => {
  if (headers['content-type'] !== null) {
    context.addIssue({
      code: 'custom',
      path: ['headers', 'content-type'],
      message: '204 응답에는 Content-Type이 없어야 합니다.'
    })
  }
  if (headers['idempotency-replayed'] !== null || headers.location !== null) {
    context.addIssue({
      code: 'custom',
      path: ['headers'],
      message: '204 응답에는 replay 또는 Location header가 없어야 합니다.'
    })
  }
}

export const practiceTransportHeadersSchema = z
  .object({
    'cache-control': z.literal('private, no-store'),
    'content-type': z.string().nullable(),
    'idempotency-replayed': z.enum(['true']).nullable(),
    location: z.string().nullable(),
    'x-nihongo-practice-contract': z.enum(['1', '2'])
  })
  .strict()

export const createPracticeTransportResponseSchema = <
  BodySchema extends z.ZodType,
  StatusSchema extends z.ZodType
>(
  bodySchema: BodySchema,
  statusSchema: StatusSchema
) =>
  z
    .object({
      data: bodySchema,
      headers: practiceTransportHeadersSchema,
      status: statusSchema
    })
    .strict()
