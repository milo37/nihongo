import { z } from 'zod'
import { cachedStorage } from '@nihongo/browser/libs/storage'

// Today's pick, on this device only: reopening shows the answer again and
// nothing reaches the server (subtract table, daily question rules).
const DAILY_ANSWER_KEY = 'harumaru:daily-answer:v1'

const answerSchema = z
  .object({
    date: z.string(),
    questionId: z.string(),
    optionId: z.string()
  })
  .strict()

type DailyAnswer = z.output<typeof answerSchema>

export const readDailyAnswer = (
  date: string,
  questionId: string
): string | null => {
  try {
    const parsed = answerSchema.safeParse(
      JSON.parse(cachedStorage.getItem(DAILY_ANSWER_KEY) ?? 'null')
    )
    return parsed.success &&
      parsed.data.date === date &&
      parsed.data.questionId === questionId
      ? parsed.data.optionId
      : null
  } catch {
    return null
  }
}

export const saveDailyAnswer = (answer: DailyAnswer): void => {
  cachedStorage.setItem(DAILY_ANSWER_KEY, JSON.stringify(answer))
}
