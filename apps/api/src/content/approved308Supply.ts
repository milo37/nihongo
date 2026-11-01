import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  adminQuestionContentInputSchema,
  normalizePhase7TagKey,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'
import {
  approved308InventoryRawJson,
  approved308RawSources
} from './approved308SourceData.js'

export const approved308InventorySha256 =
  'adbbaf21660607b509a4a95fe68604bbdbe28ee897a053c1f0889141f1057a81'
export const approved308TagMigration = '20261010071000_phase7_approved308_tags'
export const approved308TagCommand = 'SELECT "apply_phase7_approved308_tags"()'

const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex')
const inventorySchema = z.looseObject({
  uniqueApprovedOriginalCount: z.literal(308),
  items: z
    .array(
      z.looseObject({
        id: z.string(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
        verdict: z.literal('PASS'),
        level: z.string(),
        subject: z.string(),
        questionType: z.string(),
        tags: z.array(z.string()),
        explanationJaAuthored: z.literal(false)
      })
    )
    .length(308)
})
const originalSchema = z.looseObject({
  id: z.string(),
  draftId: z.string(),
  level: z.string(),
  subject: z.string(),
  questionType: z.string(),
  difficulty: z.string(),
  questionText: z.string(),
  passage: z.string().nullable().optional(),
  explanationKo: z.string(),
  explanationJa: z.null(),
  options: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  tags: z.array(z.string()).min(1),
  optionRationalesKo: z.array(z.string()).length(4),
  learningGoalKo: z.string()
})

// Only the frozen byte strings are authoritative. Parse a fresh copy per call so
// a consumer cannot mutate the next import or replace the approved provenance.
export const readApproved308Supply = () => {
  if (sha256(approved308InventoryRawJson) !== approved308InventorySha256) {
    throw new Error('Approved308 inventory byte hash mismatch.')
  }
  const inventory = inventorySchema.parse(
    JSON.parse(approved308InventoryRawJson) as unknown
  )
  const ids = new Set<string>()
  const items = approved308RawSources.map((row, index) => {
    const entry = inventory.items[index]
    const original = originalSchema.parse(JSON.parse(row.rawJson) as unknown)
    if (
      !entry ||
      row.id !== entry.id ||
      original.id !== entry.id ||
      row.sha256 !== entry.sha256 ||
      sha256(row.rawJson) !== entry.sha256 ||
      ids.has(entry.id) ||
      original.level !== entry.level ||
      original.subject !== entry.subject ||
      original.questionType !== entry.questionType ||
      JSON.stringify(original.tags) !== JSON.stringify(entry.tags)
    ) {
      throw new Error('Approved308 source/provenance mismatch.')
    }
    ids.add(entry.id)
    const content = adminQuestionContentInputSchema.parse({
      level: original.level,
      subject: original.subject,
      questionType: original.questionType,
      difficulty: original.difficulty,
      questionText: original.questionText,
      passage: original.passage ?? null,
      explanationKo: original.explanationKo,
      explanationJa: original.explanationJa,
      options: original.options.map((text, optionIndex) => ({
        clientOptionKey: `option-${optionIndex + 1}`,
        text
      })),
      correctOptionKey: `option-${original.correctIndex + 1}`,
      tagNames: original.tags
    })
    return {
      provenance: entry,
      original,
      importItem: { clientItemId: entry.id, content }
    }
  })
  if (ids.size !== 308) throw new Error('Approved308 source count mismatch.')
  return { inventory, items }
}

// Four requests respect the existing CMS maximum100. These create DRAFTs;
// returned live IDs must pass the existing review/publish workflow before study.
export const createApproved308Imports = () => {
  const { items } = readApproved308Supply()
  return [0, 100, 200, 300].map((offset) =>
    validateQuestionImportRequestSchema.parse({
      items: items
        .slice(offset, offset + 100)
        .map(({ importItem }) => importItem)
    })
  )
}

export const createApproved308TagRequirements = () => {
  const tuples = new Map<
    string,
    {
      label: string
      normalizedName: string
      level: string
      subject: string
      questionType: string
    }
  >()
  for (const {
    importItem: { content }
  } of readApproved308Supply().items) {
    for (const label of content.tagNames) {
      const normalizedName = normalizePhase7TagKey(label)
      const key = [
        normalizedName,
        content.level,
        content.subject,
        content.questionType
      ].join('\0')
      const existing = tuples.get(key)
      if (existing && existing.label !== label) {
        throw new Error(
          'Approved308 contains conflicting labels for one tag key.'
        )
      }
      tuples.set(key, {
        label,
        normalizedName,
        level: content.level,
        subject: content.subject,
        questionType: content.questionType
      })
    }
  }
  return [...tuples.entries()]
    .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(([, tuple]) => tuple)
}
