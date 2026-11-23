import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { passageAudioMarksSchema } from '@nihongo/contracts/question/passage-audio'

/**
 * #1183: asks the audio bucket whether a key was already made, so a run
 * whose list is behind the bucket does not pay for the same files again.
 * The making role may read audio/passages/* but not list the bucket, so a
 * missing object answers 403 as well as 404: both mean "make it". A dev tool
 * like the Polly engine; it stays out of the build.
 */
export type StoredPassageAudio = (
  key: string
) => Promise<{ durationMs: number } | null>

const isMissing = (error: unknown): boolean => {
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode
  const name = (error as { name?: string })?.name
  return (
    status === 403 ||
    status === 404 ||
    name === 'NotFound' ||
    name === 'NoSuchKey' ||
    name === 'AccessDenied'
  )
}

export const s3StoredPassageAudio = (
  bucket: string,
  // the bucket's own region comes from AWS_REGION; only Polly is pinned
  client: Pick<S3Client, 'send'> = new S3Client({})
): StoredPassageAudio => {
  return async (key) => {
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: `audio/passages/${key}.mp3`
        })
      )
      const marks = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: `audio/passages/${key}.marks.json`
        })
      )
      if (!marks.Body) return null
      const parsed = passageAudioMarksSchema.parse(
        JSON.parse(await marks.Body.transformToString('utf8'))
      )
      return { durationMs: parsed.durationMs }
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }
}
