import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createAdminImportValidationDigest,
  createQuestionDuplicateIdentityKey
} from '@nihongo/contracts/admin/content-operations'
import { originalQuestionSeeds } from '../../prisma/seed-data/questions/index.js'
import {
  approved308InventoryRawJson,
  approved308RawSources
} from './approved308SourceData.js'
import {
  approved308InventorySha256,
  createApproved308Imports,
  importTagKeys,
  readApproved308Supply
} from './approved308Supply.js'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
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
      // #646 3b: import items carry the remapped tags.v2.json key.
      expect(c.tagNames).toEqual(importTagKeys(original.id))
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
      createQuestionDuplicateIdentityKey({
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
        createQuestionDuplicateIdentityKey({
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
})
