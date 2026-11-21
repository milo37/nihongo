import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  applyRushWordLoad,
  parseRushWordList,
  planRushWordLoad,
  type RushWordRow
} from './rushWordList.js'

const REPOSITORY_FILE = new URL(
  '../../../../content/rush/kanji-words.v1.json',
  import.meta.url
)
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const

const word = (level: string, index: number) => ({
  level,
  word: `漢${index}`,
  reading: 'かん',
  wrong: ['がん', 'かい', 'けん'],
  source: `${level.toLowerCase()}-${index}`
})
const fullList = () =>
  LEVELS.flatMap((level) =>
    Array.from({ length: 20 }, (_, index) => word(level, index))
  )
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value))
const parse = (items: unknown[]) =>
  parseRushWordList(encode({ version: 1, items }))

describe('rush word list (#1043)', () => {
  it('accepts the repository file: 40 words per level, dictionary forms', () => {
    const list = parseRushWordList(readFileSync(REPOSITORY_FILE))
    expect(list.sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(
      LEVELS.map(
        (level) => list.words.filter((entry) => entry.level === level).length
      )
    ).toEqual([40, 40, 40, 40, 40])
  })

  it.each([
    ['a conjugated word', { word: '聞きました' }],
    ['a te-form word', { word: '急いで' }],
    ['a word without kanji', { word: 'かな' }],
    ['a katakana reading', { reading: 'カン' }],
    [
      'a wrong reading equal to the reading',
      { wrong: ['かん', 'かい', 'けん'] }
    ],
    ['two equal wrong readings', { wrong: ['がん', 'がん', 'けん'] }],
    ['two wrong readings', { wrong: ['がん', 'かい'] }],
    ['an unknown field', { note: 'x' }]
  ])('rejects %s', (_, change) => {
    const items = fullList()
    items[0] = { ...items[0]!, ...change }
    expect(() => parse(items)).toThrow()
  })

  it('rejects a repeated key or word and a level under 20 words', () => {
    const items = fullList()
    expect(() =>
      parse([...items, { ...word('N5', 99), source: 'n5-0' }])
    ).toThrow('RUSH_WORD_DUPLICATE')
    expect(() =>
      parse([...items, { ...word('N5', 0), source: 'n5-99' }])
    ).toThrow('RUSH_WORD_DUPLICATE')
    expect(() => parse(items.slice(1))).toThrow('RUSH_LEVEL_TOO_FEW:N5')
  })

  it('plans deletes first, then updates and creates by source key', () => {
    const list = parse(fullList())
    const [first, second] = list.words
    const rows: RushWordRow[] = [
      { id: 'kept', ...first!, wrong: [...first!.wrong] },
      { id: 'changed', ...second!, reading: 'べつ' },
      { ...second!, id: 'gone', sourceKey: 'left-the-file', word: '去' }
    ]
    const plan = planRushWordLoad(list, rows)
    expect(plan.unchanged).toBe(1)
    expect(plan.steps.slice(0, 2)).toEqual([
      { kind: 'delete', id: 'gone' },
      { kind: 'update', id: 'changed', word: second }
    ])
    expect(plan.steps.slice(2)).toHaveLength(list.words.length - 2)
    expect(plan.steps.slice(2).every((step) => step.kind === 'create')).toBe(
      true
    )
  })

  it('applies every step and stops when one misses its row', async () => {
    const list = parse(fullList())
    const plan = planRushWordLoad(list, [])
    const execute = vi.fn(async () => 1)
    await applyRushWordLoad(execute, plan)
    expect(execute).toHaveBeenCalledTimes(list.words.length)
    expect(execute.mock.calls[0]).toEqual([
      expect.stringContaining('INSERT INTO "RushKanjiWord"'),
      ['n5-0', 'N5', '漢0', 'かん', ['がん', 'かい', 'けん']]
    ])
    await expect(applyRushWordLoad(async () => 0, plan)).rejects.toThrow(
      'RUSH_WORD_LOAD_RESULT_INVALID'
    )
  })
})
