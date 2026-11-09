import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'
import { describe, expect, it } from 'vitest'
import {
  questionImportDirectory,
  questionImportFileNames
} from './questionImportFiles.js'
import { parseTagList } from '../src/content/tagList.js'

const importFileNames = questionImportFileNames
const readImportFile = (name: string): unknown =>
  JSON.parse(readFileSync(join(questionImportDirectory, name), 'utf8'))

describe('question import files (#633)', () => {
  it('are the ten level files (JLP-816)', () => {
    expect(readdirSync(questionImportDirectory).sort()).toEqual(
      [...importFileNames].sort()
    )
  })

  it('are valid import requests of at most 100 unique items', () => {
    const ids = new Set<string>()
    let count = 0
    for (const name of importFileNames) {
      const request = validateQuestionImportRequestSchema.parse(
        readImportFile(name)
      )
      for (const item of request.items) {
        expect(
          adminQuestionContentInputSchema.safeParse(item.content).success,
          item.clientItemId
        ).toBe(true)
        expect(ids.has(item.clientItemId), item.clientItemId).toBe(false)
        ids.add(item.clientItemId)
        count += 1
      }
    }
    expect(count).toBe(500)
  })

  it('use one or two active tags.v2.json keys of the item subject (#646)', () => {
    const { tags } = parseTagList(
      readFileSync(join(questionImportDirectory, '../taxonomy/tags.v2.json'))
    )
    expect(tags).toHaveLength(18)
    const subjectByKey = new Map(
      tags
        .filter(({ status }) => status === 'ACTIVE')
        .map(({ key, subject }) => [key, subject])
    )
    const counts = new Map<string, number>()
    for (const name of importFileNames) {
      const { items } = validateQuestionImportRequestSchema.parse(
        readImportFile(name)
      )
      for (const { clientItemId, content } of items) {
        expect(content.tagNames.length, clientItemId).toBeLessThanOrEqual(2)
        for (const key of content.tagNames) {
          expect(subjectByKey.get(key), `${clientItemId} ${key}`).toBe(
            content.subject
          )
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
    }
    // Every listed tag has at least one question.
    expect([...counts.keys()].sort()).toEqual([...subjectByKey.keys()].sort())
  })
})
