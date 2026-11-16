import { z } from 'zod'
import { cachedStorage } from '@nihongo/browser/libs/storage'
import { LEVELS, SUBJECTS } from '@nihongo/browser/common/types/domain'

// The level and subject last picked or started, kept on this device only
// (subtract table 2; #1075 keeps a pick at once). A new device starts from N5 and vocabulary.
export const LAST_PRACTICE_CHOICE_KEY = 'harumaru:last-practice:v1'

const choiceSchema = z
  .object({ level: z.enum(LEVELS), subject: z.enum(SUBJECTS) })
  .strict()

export type LastPracticeChoice = z.output<typeof choiceSchema>

export const readLastPracticeChoice = (): LastPracticeChoice | null => {
  try {
    const raw = cachedStorage.getItem(LAST_PRACTICE_CHOICE_KEY)
    if (!raw) return null
    const parsed = choiceSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const saveLastPracticeChoice = (choice: LastPracticeChoice): void => {
  cachedStorage.setItem(LAST_PRACTICE_CHOICE_KEY, JSON.stringify(choice))
}

// A pick arrives as a select's text; anything unknown is left unsaved.
export const rememberPracticeChoice = (choice: {
  level: string
  subject: string
}): void => {
  const parsed = choiceSchema.safeParse(choice)
  if (parsed.success) saveLastPracticeChoice(parsed.data)
}
