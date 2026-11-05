import { z } from 'zod'

export const opaqueIdSchema = z.uuid().transform((value) => value.toLowerCase())
export const requestIdSchema = z.uuid()
