import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  questionImportDirectory,
  questionImportFileNames
} from '../../prisma/questionImportFiles.js'
import {
  QUESTION_SET_FILE_NAMES,
  readQuestionSet
} from './questionSetPublish.js'

const directories: string[] = []
const copySet = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'question-set-'))
  directories.push(directory)
  for (const name of QUESTION_SET_FILE_NAMES)
    await copyFile(join(questionImportDirectory, name), join(directory, name))
  return directory
}

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('question set files (JLP-828)', () => {
  it('names the same 10 files as the question import source', () => {
    expect(QUESTION_SET_FILE_NAMES).toEqual(questionImportFileNames)
  })

  it('reads the 500 questions with a SHA-256 per file', async () => {
    const files = await readQuestionSet(await copySet())
    expect(files.map(({ name }) => name)).toEqual(QUESTION_SET_FILE_NAMES)
    expect(files.reduce((total, file) => total + file.items.length, 0)).toBe(
      500
    )
    for (const file of files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('refuses a missing or an extra file', async () => {
    const missing = await copySet()
    await rm(join(missing, 'n1.add.v1.json'))
    await expect(readQuestionSet(missing)).rejects.toMatchObject({
      code: 'QUESTION_SET_FILES_INVALID'
    })
    const extra = await copySet()
    await writeFile(join(extra, 'notes.txt'), 'x')
    await expect(readQuestionSet(extra)).rejects.toMatchObject({
      code: 'QUESTION_SET_FILES_INVALID'
    })
  })

  it('refuses a file that is not an import request', async () => {
    const directory = await copySet()
    await writeFile(join(directory, 'n5.v1.json'), '{"items":[]}')
    await expect(readQuestionSet(directory)).rejects.toMatchObject({
      code: 'QUESTION_SET_FILE_INVALID'
    })
  })
})
