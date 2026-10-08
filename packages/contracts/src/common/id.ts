import { z } from 'zod'

export const opaqueIdSchema = z.uuid().transform((value) => value.toLowerCase())
export const requestIdSchema = z.uuid()

export type OpaqueId = z.output<typeof opaqueIdSchema>
export type RequestId = z.output<typeof requestIdSchema>
