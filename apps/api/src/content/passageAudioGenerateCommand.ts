import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFuriganaPassageList } from './furiganaPassageList.js'
import {
  parsePassageAudioList,
  planPassageAudio,
  type PassageAudioList
} from './passageAudioList.js'
import { pollySynthesizer } from './passageAudioPolly.js'
import { s3StoredPassageAudio } from './passageAudioStore.js'

/**
 * #1183: makes the read-aloud files for reading passages whose readings were
 * reviewed (content/furigana) and that have no file for the current key.
 * Without PASSAGE_AUDIO_CONFIRM=GENERATE_PASSAGE_AUDIO it only reports what
 * it would make and how many characters that bills. Files go to
 * PASSAGE_AUDIO_OUT/audio/passages/; the list in content/audio is rewritten.
 * With PASSAGE_AUDIO_BUCKET set, a key the list does not know is first looked
 * up in that bucket and not made again when it is there. Upload the files
 * before the list reaches a release. Prints one JSON line.
 */
const VOICE = 'Takumi'
const CONFIRM = 'GENERATE_PASSAGE_AUDIO'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const furiganaFile = resolve(root, 'content/furigana/reading-passages.v1.json')
const listFile = resolve(root, 'content/audio/reading-passages.audio.v1.json')

const run = async (): Promise<void> => {
  const synthesizer = pollySynthesizer(VOICE)
  const furigana = parseFuriganaPassageList(await readFile(furiganaFile))
  const current = await readFile(listFile, 'utf8').then(
    parsePassageAudioList,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    }
  )
  const plan = planPassageAudio(
    furigana,
    current,
    synthesizer.engine,
    synthesizer.voice
  )
  const bucket = process.env.PASSAGE_AUDIO_BUCKET
  if (bucket) {
    const stored = s3StoredPassageAudio(bucket)
    for (const entry of plan) {
      if (entry.made) continue
      const found = await stored(entry.key)
      if (found)
        entry.made = { textMd5: entry.textMd5, key: entry.key, ...found }
    }
  }
  const missing = plan.filter((entry) => entry.made === null)
  // Polly bills the text without tags, once for audio and once for marks.
  const billedCharacters = missing.reduce(
    (sum, entry) => sum + 2 * Array.from(entry.text).length,
    0
  )
  const confirmed = process.env.PASSAGE_AUDIO_CONFIRM === CONFIRM
  const out = process.env.PASSAGE_AUDIO_OUT
  if (confirmed && !out) throw new Error('PASSAGE_AUDIO_OUT is required.')

  const next: PassageAudioList = {
    schemaVersion: 1,
    engine: synthesizer.engine,
    voice: synthesizer.voice,
    passages: []
  }
  if (confirmed && out) {
    const directory = resolve(out, 'audio/passages')
    await mkdir(directory, { recursive: true })
    for (const entry of plan) {
      if (entry.made) {
        next.passages.push(entry.made)
        continue
      }
      const { audio, marks } = await synthesizer.synthesize(
        entry.text,
        entry.segments
      )
      await writeFile(resolve(directory, `${entry.key}.mp3`), audio)
      await writeFile(
        resolve(directory, `${entry.key}.marks.json`),
        `${JSON.stringify(marks)}\n`
      )
      next.passages.push({
        textMd5: entry.textMd5,
        key: entry.key,
        durationMs: marks.durationMs
      })
    }
    await mkdir(resolve(root, 'content/audio'), { recursive: true })
    await writeFile(listFile, `${JSON.stringify(next, null, 2)}\n`)
  }
  process.stdout.write(
    `${JSON.stringify({
      event: confirmed
        ? 'passage_audio.generated'
        : 'passage_audio.generate_preview',
      voice: synthesizer.voice,
      passages: plan.length,
      toMake: missing.length,
      billedCharacters
    })}\n`
  )
}

await run()
