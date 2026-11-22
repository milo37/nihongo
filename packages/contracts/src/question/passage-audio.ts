import { z } from 'zod'

/**
 * #1183: the timing file that goes with a passage's read-aloud mp3, at
 * /audio/passages/<key>.marks.json. start and length count code points
 * (Array.from) of the passage exactly as sent, like passageFurigana. time is
 * milliseconds from the start of the mp3 at normal speed; playbackRate keeps
 * it in step. Which speech engine made the file is not part of the format.
 */
const markSchema = z
  .object({
    time: z.number().int().min(0),
    start: z.number().int().min(0),
    length: z.number().int().min(1)
  })
  .strict()

export const passageAudioMarksSchema = z
  .object({
    schemaVersion: z.literal(1),
    durationMs: z.number().int().min(1),
    // Words and sentences, each in time order.
    words: z.array(markSchema),
    sentences: z.array(markSchema)
  })
  .strict()

export type PassageAudioMark = z.infer<typeof markSchema>
export type PassageAudioMarks = z.infer<typeof passageAudioMarksSchema>
