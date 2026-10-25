import { z } from 'zod'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import { opaqueIdSchema } from '@nihongo/contracts/common/id'
import { cachedSessionStorage } from '@nihongo/browser/libs/storage'
import { questionCommands } from '@app/admin-question/detail/questionWorkflow'
export const safeQuestionReturn = (value: unknown): string => {
  const path = safeSsoReturnPath(typeof value === 'string' ? value : null)
  return path.split('?')[0] === '/admin/questions' ? path : '/admin/questions'
}
const contextSchema = z
  .object({
    actorId: opaqueIdSchema,
    questionId: opaqueIdSchema,
    versionId: opaqueIdSchema,
    questionRowVersion: z.number().int().positive().safe(),
    versionRowVersion: z.number().int().positive().safe(),
    returnTo: z.string(),
    command: z.enum(questionCommands),
    note: z.string().max(2000)
  })
  .strict()
export type QuestionFreshContext = z.infer<typeof contextSchema>
const key = (actorId: string, questionId: string): string =>
  `nihongo:admin-question:fresh:v1:${actorId}:${questionId}`
export const saveQuestionFreshContext = (
  input: QuestionFreshContext
): boolean => {
  const parsed = contextSchema.safeParse(input)
  return (
    parsed.success &&
    cachedSessionStorage.setItem(
      key(input.actorId, input.questionId),
      JSON.stringify({
        ...parsed.data,
        returnTo: safeQuestionReturn(input.returnTo)
      })
    )
  )
}
export const readQuestionFreshContext = (
  actorId: string,
  questionId: string
): QuestionFreshContext | null => {
  try {
    const parsed = contextSchema.safeParse(
      JSON.parse(
        cachedSessionStorage.getItem(key(actorId, questionId)) ?? 'null'
      )
    )
    return parsed.success &&
      parsed.data.actorId === actorId &&
      parsed.data.questionId === questionId
      ? { ...parsed.data, returnTo: safeQuestionReturn(parsed.data.returnTo) }
      : null
  } catch {
    return null
  }
}
export const discardQuestionFreshContext = (
  actorId: string,
  questionId: string
): void => cachedSessionStorage.removeItem(key(actorId, questionId))
