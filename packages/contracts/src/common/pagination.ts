import { z, type ZodType } from 'zod'

export const pageRequestSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict()

export const createPageResponseSchema = <ItemSchema extends ZodType>(
  itemSchema: ItemSchema
) =>
  z
    .object({
      items: z.array(itemSchema),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
      total: z.number().int().nonnegative()
    })
    .strict()

export type PageRequest = z.output<typeof pageRequestSchema>
