import { describe, expect, it } from 'vitest'
import { s3StoredPassageAudio } from './passageAudioStore.js'

const failure = (status: number, name: string) =>
  Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode: status }
  })

const client = (answers: Array<unknown>) => {
  const keys: string[] = []
  return {
    keys,
    send: async (command: { input: { Key: string } }) => {
      keys.push(command.input.Key)
      const answer = answers.shift()
      if (answer instanceof Error) throw answer
      return answer
    }
  }
}

const marks = (durationMs: number) => ({
  Body: {
    transformToString: async () =>
      JSON.stringify({ schemaVersion: 1, durationMs, words: [], sentences: [] })
  }
})

describe('stored passage audio (#1183)', () => {
  it('skips a key whose mp3 and timings are in the bucket', async () => {
    const fake = client([{}, marks(4200)])
    const stored = s3StoredPassageAudio('bucket', fake as never)
    await expect(stored('k')).resolves.toEqual({ durationMs: 4200 })
    expect(fake.keys).toEqual([
      'audio/passages/k.mp3',
      'audio/passages/k.marks.json'
    ])
  })

  it('makes a key the bucket answers 403 or 404 for', async () => {
    for (const answer of [
      failure(403, 'Forbidden'),
      failure(404, 'NotFound'),
      failure(404, 'NoSuchKey')
    ]) {
      const stored = s3StoredPassageAudio('bucket', client([answer]) as never)
      await expect(stored('k')).resolves.toBeNull()
    }
    const half = s3StoredPassageAudio(
      'bucket',
      client([{}, failure(403, 'AccessDenied')]) as never
    )
    await expect(half('k')).resolves.toBeNull()
  })

  it('stops on any other failure', async () => {
    const stored = s3StoredPassageAudio(
      'bucket',
      client([failure(500, 'InternalError')]) as never
    )
    await expect(stored('k')).rejects.toThrow('InternalError')
  })
})
