import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  adminQuestionContentInputSchema,
  normalizeContentTagKey,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'
import { describe, expect, it } from 'vitest'
import {
  buildQuestionImportFiles,
  questionImportDirectory
} from './questionImportFiles.js'

const generated = buildQuestionImportFiles()
const importFileNames = Object.keys(generated).filter(
  (name) => name !== 'required-tags.v1.json'
)
const readImportFile = (name: string): unknown =>
  JSON.parse(readFileSync(join(questionImportDirectory, name), 'utf8'))

describe('question import files (#633)', () => {
  it('match the in-code originals', () => {
    expect(readdirSync(questionImportDirectory).sort()).toEqual(
      Object.keys(generated).sort()
    )
    for (const [name, value] of Object.entries(generated)) {
      expect(readImportFile(name), name).toEqual(
        JSON.parse(JSON.stringify(value))
      )
    }
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
    expect(count).toBe(65 + 308)
  })

  it('list every tag and applicability the import files use', () => {
    const { tags } = readImportFile('required-tags.v1.json') as {
      tags: Array<{
        normalizedName: string
        applicability: Array<{
          level: string
          subject: string
          questionType: string
        }>
      }>
    }
    const listed = new Set(
      tags.flatMap(({ normalizedName, applicability }) =>
        applicability.map(
          ({ level, subject, questionType }) =>
            `${normalizedName}/${level}/${subject}/${questionType}`
        )
      )
    )
    expect(new Set(tags.map(({ normalizedName }) => normalizedName)).size).toBe(
      tags.length
    )
    for (const name of importFileNames) {
      const { items } = validateQuestionImportRequestSchema.parse(
        readImportFile(name)
      )
      for (const { content } of items) {
        for (const tagName of content.tagNames) {
          expect(
            listed.has(
              `${normalizeContentTagKey(tagName)}/${content.level}/${content.subject}/${content.questionType}`
            ),
            tagName
          ).toBe(true)
        }
      }
    }
  })
})
