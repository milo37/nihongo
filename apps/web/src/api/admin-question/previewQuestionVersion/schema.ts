import {
  previewQuestionVersionParamsSchema as previewQuestionVersionRequestSchema,
  previewQuestionVersionResponseSchema as previewQuestionVersionResponseSchema
} from '@nihongo/contracts/admin/phase7'
import type { z } from 'zod'
export {
  previewQuestionVersionRequestSchema,
  previewQuestionVersionResponseSchema
}
export type PreviewQuestionVersionRequest = z.input<
  typeof previewQuestionVersionRequestSchema
>
export type PreviewQuestionVersionResponse = z.output<
  typeof previewQuestionVersionResponseSchema
>
