import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TokenizerBuilder } from 'lindera-wasm-nodejs-ipadic'
import { draftRuby, kanjiWithoutReading } from './furiganaRuby.js'
import {
  collectImportedPassages,
  parseFuriganaPassageList,
  planFuriganaPassageList
} from './furiganaPassageList.js'

/**
 * #1182: writes content/furigana/reading-passages.v1.json from the reading
 * passages of content/question-imports. A development tool: the analyzer
 * (lindera, IPADIC dictionary) is a dev dependency and this file stays out of
 * the build. Reviewed entries are never overwritten. Prints one JSON line.
 */
const GENERATOR = 'lindera-wasm-nodejs-ipadic 2.0.0 (IPADIC)'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const importDirectory = resolve(root, 'content/question-imports')
const listFile = resolve(root, 'content/furigana/reading-passages.v1.json')

type Token = { surface: string; reading?: string }

const run = async (): Promise<void> => {
  const builder = new TokenizerBuilder()
  builder.setDictionary('embedded://ipadic')
  builder.setMode('normal')
  const tokenizer = builder.build()
  const draft = (text: string): string =>
    draftRuby(text, tokenizer.tokenize(text) as Token[])

  const names = (await readdir(importDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort()
  const files = await Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(resolve(importDirectory, name), 'utf8'))
    )
  )
  const current = await readFile(listFile).then(
    (bytes) => parseFuriganaPassageList(bytes),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    }
  )
  const next = planFuriganaPassageList(
    collectImportedPassages(files),
    current,
    draft,
    GENERATOR
  )
  await writeFile(listFile, `${JSON.stringify(next, null, 2)}\n`)
  const unread = next.passages.flatMap((entry) =>
    kanjiWithoutReading(entry.ruby)
  )
  process.stdout.write(
    `${JSON.stringify({
      event: 'furigana.passages.generated',
      passages: next.passages.length,
      reviewed: next.passages.filter((entry) => entry.reviewedBy !== null)
        .length,
      kanjiWithoutReading: unread.length
    })}\n`
  )
}

await run()
