import type { JlptLevel, QuestionSubject } from '../generated/prisma/client.js'

interface RawQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

/**
 * #1220: the "ReadingPassage" row id for a version's passage text (null
 * without one). The row is shared by level, subject and exact text; a new
 * text for a question that had another passage replaces it (#1196).
 */
export const resolveReadingPassageId = async (
  client: RawQueryClient,
  input: {
    readonly questionId: string
    readonly level: JlptLevel
    readonly subject: QuestionSubject
    readonly passage: string | null
    /** The version being edited, never its own source passage. */
    readonly editedVersionId?: string
  }
): Promise<string | null> => {
  if (input.passage === null) return null
  const rows = await client.$queryRawUnsafe<Array<{ id: string | null }>>(
    `SELECT resolve_reading_passage($1::uuid, $2::"JlptLevel",
       $3::"QuestionSubject", $4::text, $5::uuid)::text AS "id"`,
    input.questionId,
    input.level,
    input.subject,
    input.passage,
    input.editedVersionId ?? null
  )
  const id = rows[0]?.id
  if (!id) throw new Error('The reading passage row was not resolved.')
  return id
}
