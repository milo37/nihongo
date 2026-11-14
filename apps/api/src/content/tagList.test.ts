import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTagList, planTagLoad } from './tagList.js'
import type { TagRow } from './tagList.js'

const sample = readFileSync(
  new URL('../../test/fixtures/content/tags.v2.sample.json', import.meta.url)
)
const bytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))
const entry = {
  key: 'vocab.sample-noun',
  label: '예시 어휘',
  subject: 'VOCABULARY',
  status: 'ACTIVE'
}
const row = (overrides: Partial<TagRow>): TagRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  key: 'vocab.sample-noun',
  label: '예시 어휘',
  normalizedName: '예시 어휘',
  subject: 'VOCABULARY',
  status: 'ACTIVE',
  labelJa: null,
  ...overrides
})

describe('tag list file', () => {
  it('parses the sample format with a file hash', () => {
    const list = parseTagList(sample)
    expect(list.sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(
      list.tags.map(({ key, subject, status }) => [key, subject, status])
    ).toEqual([
      ['vocab.sample-noun', 'VOCABULARY', 'ACTIVE'],
      ['grammar.sample', 'GRAMMAR', 'ACTIVE'],
      ['reading.sample', 'READING', 'RETIRED']
    ])
  })

  it('normalizes the name like admin tag lookups', () => {
    const [tag] = parseTagList(
      bytes({ schemaVersion: 2, tags: [{ ...entry, label: ' ＡＢ  c ' }] })
    ).tags
    expect(tag).toMatchObject({ label: 'ＡＢ  c', normalizedName: 'ab c' })
  })

  it.each([
    ['an old schema version', { schemaVersion: 1, tags: [entry] }],
    ['an empty list', { schemaVersion: 2, tags: [] }],
    ['an unknown field', { schemaVersion: 2, tags: [{ ...entry, x: 1 }] }],
    [
      'an invalid key',
      { schemaVersion: 2, tags: [{ ...entry, key: 'Vocab' }] }
    ],
    ['a blank name', { schemaVersion: 2, tags: [{ ...entry, label: ' ' }] }],
    [
      'a key prefix of another subject',
      { schemaVersion: 2, tags: [{ ...entry, subject: 'GRAMMAR' }] }
    ],
    [
      'a repeated key',
      { schemaVersion: 2, tags: [entry, { ...entry, label: '다른 이름' }] }
    ],
    [
      'a repeated name',
      {
        schemaVersion: 2,
        tags: [entry, { ...entry, key: 'vocab.other', label: '예시  어휘' }]
      }
    ]
  ])('rejects %s', (_label, value) => {
    expect(() => parseTagList(bytes(value))).toThrow()
  })

  it('rejects bytes that are not UTF-8 JSON', () => {
    expect(() => parseTagList(new Uint8Array([0xff]))).toThrow()
  })

  it('reads the optional Japanese name (#976)', () => {
    const list = parseTagList(
      bytes({
        schemaVersion: 2,
        tags: [
          { ...entry, labelJa: ' 例の語彙 ' },
          { ...entry, key: 'vocab.other', label: '다른 어휘' }
        ]
      })
    )
    expect(list.tags.map(({ labelJa }) => labelJa)).toEqual(['例の語彙', null])
    for (const labelJa of [' ', 'あ'.repeat(41)])
      expect(() =>
        parseTagList(bytes({ schemaVersion: 2, tags: [{ ...entry, labelJa }] }))
      ).toThrow()
  })
})

describe('tag load plan', () => {
  const list = parseTagList(bytes({ schemaVersion: 2, tags: [entry] }))

  it('creates a tag that has no row', () => {
    expect(planTagLoad(list, [])).toMatchObject({
      steps: [{ kind: 'create' }],
      unchanged: 0,
      conflicts: []
    })
  })

  it('keeps an identical keyed row unchanged', () => {
    expect(planTagLoad(list, [row({})])).toMatchObject({
      steps: [],
      unchanged: 1
    })
  })

  it('updates a keyed row whose fields changed', () => {
    expect(
      planTagLoad(list, [row({ label: '옛 이름', normalizedName: '옛 이름' })])
        .steps
    ).toEqual([{ kind: 'update', id: row({}).id, tag: list.tags[0] }])
  })

  it('updates a keyed row whose Japanese name changed (#976)', () => {
    const named = parseTagList(
      bytes({ schemaVersion: 2, tags: [{ ...entry, labelJa: '例の語彙' }] })
    )
    expect(planTagLoad(named, [row({})]).steps).toEqual([
      { kind: 'update', id: row({}).id, tag: named.tags[0] }
    ])
    expect(planTagLoad(named, [row({ labelJa: '例の語彙' })])).toMatchObject({
      steps: [],
      unchanged: 1
    })
  })

  it('claims a row without a key by its name', () => {
    expect(
      planTagLoad(list, [row({ key: null, subject: null, status: null })])
    ).toMatchObject({ steps: [{ kind: 'claim' }], unkeyed: 0 })
  })

  it('reports a name held by another key as a conflict', () => {
    expect(planTagLoad(list, [row({ key: 'vocab.other' })])).toMatchObject({
      steps: [],
      conflicts: ['vocab.sample-noun']
    })
    expect(
      planTagLoad(list, [
        row({ normalizedName: '옛 이름' }),
        row({ id: '00000000-0000-4000-8000-000000000002', key: null })
      ]).conflicts
    ).toEqual(['vocab.sample-noun'])
  })

  it('counts rows missing from the file without touching them', () => {
    expect(
      planTagLoad(list, [
        row({}),
        row({
          id: '00000000-0000-4000-8000-000000000002',
          key: 'grammar.gone',
          normalizedName: '없어진 태그'
        }),
        row({
          id: '00000000-0000-4000-8000-000000000003',
          key: null,
          normalizedName: '옛 태그'
        })
      ])
    ).toMatchObject({ steps: [], unchanged: 1, notInFile: 1, unkeyed: 1 })
  })
})
