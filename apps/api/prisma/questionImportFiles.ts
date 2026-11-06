import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adminQuestionContentInputSchema,
  normalizeContentTagKey,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'
import { originalQuestionSeeds } from './seed-data/questions/index.js'
import { readApproved308Supply } from '../src/content/approved308Supply.js'

// #633: admin import request files are the question source of truth that
// replaces the in-code originals. Each file is one validateQuestionImport
// request body (at most 100 items) that the admin import screen accepts.
export const questionImportDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../content/question-imports'
)

const IMPORT_BATCH_SIZE = 100

type ImportItem = {
  clientItemId: string
  content: ReturnType<typeof adminQuestionContentInputSchema.parse>
}

const toBatches = (
  prefix: string,
  items: readonly ImportItem[]
): Record<string, unknown> =>
  Object.fromEntries(
    Array.from(
      { length: Math.ceil(items.length / IMPORT_BATCH_SIZE) },
      (_, index) => [
        `${prefix}-${index + 1}.v1.json`,
        validateQuestionImportRequestSchema.parse({
          items: items.slice(
            index * IMPORT_BATCH_SIZE,
            (index + 1) * IMPORT_BATCH_SIZE
          )
        })
      ]
    )
  )

const seedImportItems = (): ImportItem[] =>
  originalQuestionSeeds.map((seed) => ({
    clientItemId: seed.id,
    content: adminQuestionContentInputSchema.parse({
      level: seed.level,
      subject: seed.subject,
      questionType: seed.questionType,
      difficulty: seed.difficulty,
      questionText: seed.questionText,
      passage: seed.passage ?? null,
      explanationKo: seed.explanationKo,
      explanationJa: seed.explanationJa ?? null,
      options: seed.options.map((text, optionIndex) => ({
        clientOptionKey: `option-${optionIndex + 1}`,
        text
      })),
      correctOptionKey: `option-${seed.correctIndex + 1}`,
      tagNames: [...seed.tags]
    })
  }))

const approved308ImportItems = (): ImportItem[] =>
  readApproved308Supply().items.map(({ importItem }) => importItem)

/** Every tag and applicability tuple the import files need in the database. */
const requiredTags = (items: readonly ImportItem[]) => {
  const tags = new Map<
    string,
    { label: string; normalizedName: string; applicability: Set<string> }
  >()
  for (const { content } of items) {
    for (const label of content.tagNames) {
      const normalizedName = normalizeContentTagKey(label)
      const tag = tags.get(normalizedName) ?? {
        label,
        normalizedName,
        applicability: new Set<string>()
      }
      tag.applicability.add(
        `${content.level}/${content.subject}/${content.questionType}`
      )
      tags.set(normalizedName, tag)
    }
  }
  return {
    tags: [...tags.values()]
      .sort((left, right) =>
        left.normalizedName.localeCompare(right.normalizedName)
      )
      .map(({ label, normalizedName, applicability }) => ({
        label,
        normalizedName,
        applicability: [...applicability].sort().map((tuple) => {
          const [level, subject, questionType] = tuple.split('/')
          return { level, subject, questionType }
        })
      }))
  }
}

/** File name to JSON value, generated from the in-code originals. */
export const buildQuestionImportFiles = (): Record<string, unknown> => {
  const seed = seedImportItems()
  const approved308 = approved308ImportItems()
  return {
    ...toBatches('seed65', seed),
    ...toBatches('approved308', approved308),
    'required-tags.v1.json': requiredTags([...seed, ...approved308])
  }
}

// Writes the files, then formats them with the repository prettier config.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(questionImportDirectory, { recursive: true })
  const paths = Object.entries(buildQuestionImportFiles()).map(
    ([name, value]) => {
      const path = join(questionImportDirectory, name)
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
      return path
    }
  )
  execFileSync('pnpm', ['exec', 'prettier', '--write', ...paths], {
    stdio: 'inherit'
  })
}
