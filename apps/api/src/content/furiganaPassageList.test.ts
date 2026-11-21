import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRuby } from './furiganaRuby.js'
import {
  collectImportedPassages,
  md5,
  parseFuriganaPassageList,
  planFuriganaPassageList,
  type FuriganaPassageList
} from './furiganaPassageList.js'

const importDirectory = new URL(
  '../../../../content/question-imports/',
  import.meta.url
)
const listFile = new URL(
  '../../../../content/furigana/reading-passages.v1.json',
  import.meta.url
)

const item = (level: string, subject: string, passage: string | null) => ({
  content: { level, subject, passage }
})

describe('furigana passage list (#1182)', () => {
  it('collects each passage once per level and subject, in file order', () => {
    expect(
      collectImportedPassages([
        {
          items: [
            item('N4', 'READING', '雨です。'),
            item('N4', 'READING', '雨です。'),
            item('N4', 'GRAMMAR', '雨です。'),
            item('N4', 'READING', null)
          ]
        },
        { items: [item('N3', 'READING', '雪です。')] }
      ])
    ).toEqual([
      { level: 'N4', subject: 'READING', text: '雨です。' },
      { level: 'N4', subject: 'GRAMMAR', text: '雨です。' },
      { level: 'N3', subject: 'READING', text: '雪です。' }
    ])
  })

  it('keeps reviewed entries, copies their ruby as a first value and drops stale drafts', () => {
    const current: FuriganaPassageList = {
      schemaVersion: 1,
      generator: 'old',
      passages: [
        {
          level: 'N4',
          subject: 'READING',
          textMd5: md5('雨です。'),
          ruby: '{雨|あめ}です。',
          reviewedBy: 'content',
          reviewedAt: '2026-11-21'
        },
        {
          level: 'N2',
          subject: 'READING',
          textMd5: md5('雪です。'),
          ruby: '{雪|ゆき}です。',
          reviewedBy: null,
          reviewedAt: null
        }
      ]
    }
    const next = planFuriganaPassageList(
      [
        { level: 'N4', subject: 'GRAMMAR', text: '雨です。' },
        { level: 'N3', subject: 'READING', text: '風です。' }
      ],
      current,
      (text) => `draft:${text}`,
      'new'
    )

    expect(next.passages).toEqual([
      {
        level: 'N4',
        subject: 'GRAMMAR',
        textMd5: md5('雨です。'),
        ruby: '{雨|あめ}です。',
        reviewedBy: null,
        reviewedAt: null
      },
      {
        level: 'N3',
        subject: 'READING',
        textMd5: md5('風です。'),
        ruby: 'draft:風です。',
        reviewedBy: null,
        reviewedAt: null
      },
      current.passages[0]
    ])
  })

  it('rejects ruby that does not match the text, half a review and duplicates', () => {
    const entry = {
      level: 'N4',
      subject: 'READING',
      textMd5: md5('雨です。'),
      ruby: '{雨|あめ}です。',
      reviewedBy: null,
      reviewedAt: null
    }
    const list = (passages: unknown[]) =>
      JSON.stringify({ schemaVersion: 1, generator: 'g', passages })

    expect(() => parseFuriganaPassageList(list([entry]))).not.toThrow()
    expect(() =>
      parseFuriganaPassageList(list([{ ...entry, ruby: '{雪|ゆき}です。' }]))
    ).toThrow()
    expect(() =>
      parseFuriganaPassageList(list([{ ...entry, reviewedBy: 'content' }]))
    ).toThrow()
    expect(() => parseFuriganaPassageList(list([entry, entry]))).toThrow()
  })

  it('the repository list holds every imported passage exactly', () => {
    const files = readdirSync(importDirectory)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) =>
        JSON.parse(readFileSync(new URL(name, importDirectory), 'utf8'))
      )
    const imported = collectImportedPassages(files)
    const list = parseFuriganaPassageList(readFileSync(listFile))

    expect(list.passages).toHaveLength(imported.length)
    expect(
      list.passages.map((entry) => ({
        level: entry.level,
        subject: entry.subject,
        text: parseRuby(entry.ruby).text
      }))
    ).toEqual(imported)
  })
})
