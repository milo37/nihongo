import { describe, expect, it } from 'vitest'
import { md5, type FuriganaPassageList } from './furiganaPassageList.js'
import {
  applyFuriganaLoad,
  planFuriganaLoad,
  type FuriganaPassageRow
} from './furiganaLoad.js'

const entry = (
  text: string,
  ruby: string,
  reviewedBy: string | null
): FuriganaPassageList['passages'][number] => ({
  level: 'N4',
  subject: 'READING',
  textMd5: md5(text),
  ruby,
  reviewedBy,
  reviewedAt: reviewedBy === null ? null : '2026-11-21'
})

const row = (
  passageId: string,
  text: string,
  furigana: Partial<FuriganaPassageRow> = {}
): FuriganaPassageRow => ({
  passageId,
  level: 'N4',
  subject: 'READING',
  textMd5: md5(text),
  furiganaId: null,
  segments: null,
  reviewedBy: null,
  reviewedAt: null,
  ...furigana
})

const list = (passages: FuriganaPassageList['passages']) => ({
  schemaVersion: 1 as const,
  generator: 'test',
  passages
})

describe('furigana load plan (#1182)', () => {
  it('loads reviewed entries only, keeps equal rows and deletes rows that left the review', () => {
    const plan = planFuriganaLoad(
      list([
        entry('雨です。', '{雨|あめ}です。', 'content'),
        entry('雪です。', '{雪|ゆき}です。', 'content'),
        entry('風です。', '{風|かぜ}です。', 'content'),
        entry('空です。', '{空|そら}です。', null),
        entry('海です。', '{海|うみ}です。', 'content')
      ]),
      [
        row('p-rain', '雨です。'),
        row('p-snow', '雪です。', {
          furiganaId: 'f-snow',
          segments: [{ start: 0, length: 1, reading: 'ゆき' }],
          reviewedBy: 'content',
          reviewedAt: '2026-11-21'
        }),
        row('p-wind', '風です。', {
          furiganaId: 'f-wind',
          segments: [{ start: 0, length: 1, reading: 'ふう' }],
          reviewedBy: 'content',
          reviewedAt: '2026-11-21'
        }),
        row('p-sky', '空です。', {
          furiganaId: 'f-sky',
          segments: [{ start: 0, length: 1, reading: 'から' }],
          reviewedBy: 'content',
          reviewedAt: '2026-11-20'
        })
      ]
    )

    expect(plan).toEqual({
      steps: [
        { kind: 'delete', id: 'f-sky' },
        {
          kind: 'create',
          row: {
            passageId: 'p-rain',
            textMd5: md5('雨です。'),
            segments: [{ start: 0, length: 1, reading: 'あめ' }],
            reviewedBy: 'content',
            reviewedAt: '2026-11-21'
          }
        },
        {
          kind: 'update',
          id: 'f-wind',
          row: {
            passageId: 'p-wind',
            textMd5: md5('風です。'),
            segments: [{ start: 0, length: 1, reading: 'かぜ' }],
            reviewedBy: 'content',
            reviewedAt: '2026-11-21'
          }
        }
      ],
      unchanged: 1,
      reviewed: 4,
      // 海 has no passage in this database.
      missingPassage: 1
    })
  })

  it('applies steps in order and stops when one misses its row', async () => {
    const plan = planFuriganaLoad(
      list([entry('雨です。', '{雨|あめ}です。', 'content')]),
      [row('p-rain', '雨です。')]
    )
    const calls: unknown[][] = []
    await applyFuriganaLoad(async (sql, values) => {
      calls.push([sql.split(' ', 1)[0], ...values])
      return 1
    }, plan)
    expect(calls).toEqual([
      [
        'INSERT',
        'p-rain',
        md5('雨です。'),
        '[{"start":0,"length":1,"reading":"あめ"}]',
        'content',
        '2026-11-21'
      ]
    ])
    await expect(applyFuriganaLoad(async () => 0, plan)).rejects.toThrow(
      'FURIGANA_LOAD_RESULT_INVALID'
    )
  })
})
