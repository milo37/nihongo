import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createAdminImportValidationDigest,
  createPhase7QuestionDuplicateIdentity,
  normalizePhase7TagKey
} from '@nihongo/contracts/admin/phase7'
import { originalQuestionSeeds } from '../../prisma/seed-data/questions/index.js'
import {
  approved308InventoryRawJson,
  approved308RawSources
} from './approved308SourceData.js'
import {
  approved308InventorySha256,
  approved308TagMigration,
  createApproved308Imports,
  createApproved308TagRequirements,
  readApproved308Supply
} from './approved308Supply.js'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const tupleKey = (t: {
  normalizedName: string
  level: string
  subject: string
  questionType: string
}) => [t.normalizedName, t.level, t.subject, t.questionType].join('\0')
const baseNames = new Set(
  originalQuestionSeeds.flatMap((q) => q.tags.map(normalizePhase7TagKey))
)
const baseTuples = new Set(
  originalQuestionSeeds.flatMap((q) =>
    q.tags.map((label) =>
      tupleKey({ ...q, normalizedName: normalizePhase7TagKey(label) })
    )
  )
)
const sql = readFileSync(
  new URL(
    `../../prisma/migrations/${approved308TagMigration}/migration.sql`,
    import.meta.url
  ),
  'utf8'
)

describe('Frozen approved308 CMS supply source', () => {
  it('pins the canonical raw inventory and every original byte string', () => {
    expect(hash(approved308InventoryRawJson)).toBe(approved308InventorySha256)
    const { items, inventory } = readApproved308Supply()
    expect(inventory.uniqueApprovedOriginalCount).toBe(308)
    expect(items).toHaveLength(308)
    expect(new Set(items.map((x) => x.original.id)).size).toBe(308)
    for (const row of approved308RawSources)
      expect(hash(row.rawJson)).toBe(row.sha256)
  })

  it('has exactly15 cells, each >=20, separate from the original65', () => {
    expect(originalQuestionSeeds).toHaveLength(65)
    const baseIds = new Set(originalQuestionSeeds.map((q) => q.id))
    const counts = new Map<string, number>()
    for (const { original } of readApproved308Supply().items) {
      expect(baseIds.has(original.id)).toBe(false)
      const key = original.level + '|' + original.subject
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    expect(counts.size).toBe(15)
    for (const level of ['N1', 'N2', 'N3', 'N4', 'N5']) {
      for (const subject of ['VOCABULARY', 'GRAMMAR', 'READING']) {
        expect(counts.get(level + '|' + subject)).toBe(
          level === 'N5' && subject === 'READING' ? 28 : 20
        )
      }
    }
  })

  it('preserves options, answer ordinal, text, full tags, difficulty and null translation', () => {
    for (const { original, importItem } of readApproved308Supply().items) {
      const c = importItem.content
      expect(c.questionText).toBe(original.questionText)
      expect(c.passage).toBe(original.passage ?? null)
      expect(c.explanationKo).toBe(original.explanationKo)
      expect(c.options.map((x) => x.text)).toEqual(original.options)
      expect(c.correctOptionKey).toBe(`option-${original.correctIndex + 1}`)
      expect(c.tagNames).toEqual(original.tags)
      expect(c.difficulty).toBe(original.difficulty)
      expect(c.explanationJa).toBeNull()
      expect(original.optionRationalesKo).toHaveLength(4)
      expect(original.learningGoalKo.length).toBeGreaterThan(0)
    }
  })

  it('adopts the approved reading ordinals and N2 rationale correction, retaining their QA history', () => {
    const items = readApproved308Supply().items
    expect(
      items.find((x) => x.original.id === 'n4-reading-12')?.provenance.sha256
    ).toBe('bab72d3de98ebb7088443111973b493cfee49e7bbc25bae05c1da412721bb3fe')
    expect(
      items.find((x) => x.original.id === 'n4-reading-12')?.original
        .explanationKo
    ).toContain('보기2')
    expect(
      items.find((x) => x.original.id === 'n5-reading-10')?.provenance.sha256
    ).toBe('6dc0f6b077cdf3ce69312047dda611c149d17a89a5f3f501144f26a105a5d8d2')
    expect(
      items.find((x) => x.original.id === 'n5-reading-10')?.provenance
        .correctionQa
    ).toMatchObject({
      verdict: 'PASS',
      result: {
        sha256:
          '55adc543648d4c7de2c1e95284d8257f53443d85313ab35529574c031c903043'
      }
    })
    expect(
      items.find((x) => x.original.id === 'n2-vocabulary-24')?.provenance.sha256
    ).toBe('5e576f7b3795c2be9d50336f5591d7c2e828dbac5524d36aa099d2d7ab982ce0')
    expect(
      items.find((x) => x.original.id === 'n2-vocabulary-25')?.provenance.sha256
    ).toBe('bc06992db0ee413b165f6779b6cab6c29f68a1d058267b3251cba0d46b9e305c')
  })

  it('uses the existing CMS100 limit, canonical digest and fresh copies', async () => {
    const requests = createApproved308Imports()
    expect(requests.map((x) => x.items.length)).toEqual([100, 100, 100, 8])
    expect(requests.flatMap((x) => x.items.map((i) => i.clientItemId))).toEqual(
      readApproved308Supply().items.map((x) => x.original.id)
    )
    for (const request of requests) {
      const port = { digestUtf8: async (text: string) => hash(text) }
      expect(
        await createAdminImportValidationDigest(port, request.items)
      ).toMatch(/^[0-9a-f]{64}$/u)
    }
    const first = requests[0]?.items[0]
    expect(first).toBeDefined()
    if (first) first.content.tagNames.splice(0)
    expect(
      createApproved308Imports()[0]?.items[0]?.content.tagNames.length
    ).toBeGreaterThan(0)
  })

  it('has no CMS duplicate identities across approved308 and the current65', () => {
    const identities = originalQuestionSeeds.map((q) =>
      createPhase7QuestionDuplicateIdentity({
        correctOptionText: q.options[q.correctIndex] ?? '',
        optionTexts: q.options,
        passage: q.passage ?? null,
        questionText: q.questionText,
        questionType: q.questionType,
        subject: q.subject
      })
    )
    for (const { original: q } of readApproved308Supply().items)
      identities.push(
        createPhase7QuestionDuplicateIdentity({
          correctOptionText: q.options[q.correctIndex] ?? '',
          optionTexts: q.options,
          passage: q.passage ?? null,
          questionText: q.questionText,
          questionType: q.questionType,
          subject: q.subject
        })
      )
    expect(identities).toHaveLength(373)
    expect(new Set(identities).size).toBe(373)
  })

  it('has437 required triples and the closed migration adds exactly293 names/323 missing triples', () => {
    const requirements = createApproved308TagRequirements()
    const additions = requirements.filter((t) => !baseTuples.has(tupleKey(t)))
    expect(baseNames.size).toBe(107)
    expect(baseTuples.size).toBe(126)
    expect(requirements).toHaveLength(437)
    expect(new Set(requirements.map((t) => t.normalizedName)).size).toBe(388)
    expect(additions).toHaveLength(323)
    expect(
      new Set(
        additions
          .filter((t) => !baseNames.has(t.normalizedName))
          .map((t) => t.normalizedName)
      ).size
    ).toBe(293)
    const block = sql
      .split(
        'AS manifest(ordinal, label, normalized_name, level, subject, question_type)'
      )[0]
      ?.split('FOR approved IN SELECT * FROM (VALUES')[1]
    expect(block).toBeDefined()
    const parsed = [
      ...(block ?? '').matchAll(
        /\((\d+), '((?:''|[^'])*)', '((?:''|[^'])*)', '(N[1-5])', '(VOCABULARY|GRAMMAR|READING)', '([A-Z_]+)'\)/gu
      )
    ].map((m) => ({
      label: m[2]?.replaceAll("''", "'"),
      normalizedName: m[3]?.replaceAll("''", "'"),
      level: m[4],
      subject: m[5],
      questionType: m[6]
    }))
    expect(parsed).toEqual(additions)
    expect(hash(additions.map((t) => tupleKey(t) + '\n').join(''))).toBe(
      '94b63e5f57d94b9d594dd15450e5459e1eea6fbfa93069e40ccee47527fc95a0'
    )
    expect(sql).toContain('"Tag") <> 400')
    expect(sql).toContain('"TagApplicability") <> 449')
  })

  it('keeps migration objects-only with strict current38/39, immutable parent seal and migration-only execute', () => {
    const install = sql.split('DO $predecessor$')[1]?.split('$predecessor$;')[0]
    expect(install).toContain('predecessor_count <> 38')
    expect(install).toContain(
      '6aa49828fc3138b2b544830794cad68c05ed11ae2ffa018b9e43a2800cb578dd'
    )
    expect(install).toContain(
      '0e4f6c477108c053a924aa1ba0f3cba8e868853328b8626839f95939bb19c798'
    )
    expect(install).toContain(
      '81e1accc76657951962be7d3d21fdd976ea67d78c98ddb87abe6f9823edbc6ef'
    )
    expect(install).toContain(
      '4f8f2c077bc5e79a4755f007f96cd4b8e57bdd6b14f0f906faefaab79eff2fa9'
    )
    expect(sql).toContain('"_prisma_migrations") <> 39')
    expect(sql).toContain('sealed_predecessor_digest CONSTANT TEXT')
    expect(sql).toContain('JLP478_APPROVED308_PREDECESSOR_UNSET')
    expect(sql).toContain('before_state IS DISTINCT FROM after_state')
    expect(sql).toContain('p->>\'tagId\' = a."tagId"::TEXT')
    expect(sql).toContain('ORDER BY i."operationId"')
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION "apply_phase7_approved308_tags"() TO "nihongo_phase7_migration"'
    )
    expect(sql).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) "(?:Question|QuestionVersion|QuestionOption|QuestionVersionTag)"/u
    )
    expect(sql).not.toMatch(
      /DISABLE TRIGGER|CREATE OR REPLACE FUNCTION "(?:protect_phase7|validate_phase7_system)|GRANT .+ TO "nihongo_app"/u
    )
  })
})
