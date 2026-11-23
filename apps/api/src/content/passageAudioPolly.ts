import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import {
  chunkedSynthesizer,
  rawSpeechMarkSchema,
  type PassageSynthesizer
} from './passageAudio.js'

/**
 * #1183: the Amazon Polly engine (neural, Tokyo). A development tool like the
 * furigana generator: the SDK is a dev dependency, this file stays out of the
 * build and the app server has no Polly permission. Each SSML piece is one
 * mp3 request and one speech mark request (word and sentence).
 */
export const POLLY_REGION = 'ap-northeast-1'

export const pollySynthesizer = (
  voice: string,
  client = new PollyClient({ region: POLLY_REGION })
): PassageSynthesizer => {
  const request = async (
    ssml: string,
    format: 'mp3' | 'json'
  ): Promise<Uint8Array> => {
    const response = await client.send(
      new SynthesizeSpeechCommand({
        Engine: 'neural',
        VoiceId: voice as never,
        LanguageCode: 'ja-JP',
        TextType: 'ssml',
        Text: ssml,
        OutputFormat: format,
        ...(format === 'json' ? { SpeechMarkTypes: ['word', 'sentence'] } : {})
      })
    )
    if (!response.AudioStream) throw new Error('Polly sent no data.')
    return response.AudioStream.transformToByteArray()
  }
  return chunkedSynthesizer({
    engine: 'polly-neural',
    voice,
    speak: async (ssml) => {
      const audio = await request(ssml, 'mp3')
      const marks = Buffer.from(await request(ssml, 'json'))
        .toString('utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => rawSpeechMarkSchema.parse(JSON.parse(line)))
      return { audio, marks }
    }
  })
}
