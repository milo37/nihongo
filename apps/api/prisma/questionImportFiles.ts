import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// #633: admin import request files are the question source of truth. Each
// file is one validateQuestionImport request body (at most 100 items) that the
// admin import screen accepts. JLP-816: the files are the 500 rewritten
// questions, two per level (v1 50 + add 50), copied from the reviewed planning
// files as is. #1081: a third file per level (add2 50) makes 750. #1043: a
// kanji reading file per level (27/28/28/27/28) makes 888. #1239: N1 reading
// supplement B1 (45 questions on 30 passages) makes 933.
export const questionImportDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../content/question-imports'
)

export const questionImportFileNames = [
  'n5.v1.json',
  'n4.v1.json',
  'n3.v1.json',
  'n2.v1.json',
  'n1.v1.json',
  'n5.add.v1.json',
  'n4.add.v1.json',
  'n3.add.v1.json',
  'n2.add.v1.json',
  'n1.add.v1.json',
  'n5.add2.v1.json',
  'n4.add2.v1.json',
  'n3.add2.v1.json',
  'n2.add2.v1.json',
  'n1.add2.v1.json',
  'n5.kanji.v1.json',
  'n4.kanji.v1.json',
  'n3.kanji.v1.json',
  'n2.kanji.v1.json',
  'n1.kanji.v1.json',
  'n1.b1.v1.json'
] as const
