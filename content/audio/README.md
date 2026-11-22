# Passage read-aloud audio (#1183)

`reading-passages.audio.v1.json` lists the read-aloud files made for reading
passages: the md5 of the passage text, the file key and the playing time.
The files are `audio/passages/<key>.mp3` and `audio/passages/<key>.marks.json`
(word and sentence timings; positions count code points of the passage, like
passage furigana). The key is a hash of the text, the reviewed readings, the
engine, the voice and the generator version, so any change makes a new file
and an unchanged passage is never made twice.

- Only passages whose furigana is reviewed (`content/furigana`) get audio. The
  reviewed readings go to the engine as yomigana so kanji are read as written.
- Preview: `pnpm --filter @nihongo/api content:generate-passage-audio` prints
  how many files are missing and how many characters making them bills.
- Make: with `PASSAGE_AUDIO_CONFIRM=GENERATE_PASSAGE_AUDIO` and
  `PASSAGE_AUDIO_OUT=<dir>` it calls Amazon Polly (neural, Takumi,
  ap-northeast-1), writes the missing files under `<dir>/audio/passages/` and
  rewrites the list. With `PASSAGE_AUDIO_BUCKET=<bucket>` a key the list
  does not know is looked up there first (HEAD on the mp3, then the timings;
  403 or 404 means not made) and not made again. Polly is always called in
  ap-northeast-1; the bucket uses `AWS_REGION`. Upload the files before the
  list goes into a release.
  Only the role that makes audio may call `polly:SynthesizeSpeech`.
- The engine is one function (`PassageSynthesizer`); another engine replaces
  `passageAudioPolly.ts` and everything is made again.
