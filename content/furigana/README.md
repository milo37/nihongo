# Furigana (#1182)

`reading-passages.v1.json` holds one entry per reading passage: its level,
subject, the md5 of its text (the `ReadingPassage` key) and the text as ruby,
for example `{駅|えき}の{前|まえ}に`.

- Regenerate: `pnpm --filter @nihongo/api content:generate-furigana`. Entries
  with `reviewedBy` are never overwritten.
- Review: correct the readings inside `{…|…}` in place, then fill
  `reviewedBy` and `reviewedAt` (`YYYY-MM-DD`). Do not change the text outside
  the braces; the file check compares it with the import files.
- Load: `FURIGANA_LIST_FILE=… pnpm --filter @nihongo/api content:load-furigana`
  reports what would change; with `FURIGANA_LOAD_CONFIRM=LOAD_FURIGANA` it
  writes the reviewed entries as REVIEWED rows in one transaction. Rows whose
  entry left the file or is no longer reviewed are deleted.
- Learners see reviewed readings only, and only while the passage text is the
  text they were made for.

## Source of the automatic readings

The first readings come from the morphological analyzer
[Lindera](https://github.com/lindera/lindera-wasm) (`lindera-wasm-nodejs-ipadic`,
MIT) with the IPADIC dictionary. The analyzer and its dictionary are a
development dependency only: neither is copied into this repository or into
the runtime image. IPADIC is Copyright 2000, 2001, 2002, 2003 Nara Institute
of Science and Technology, All Rights Reserved; its license is
[COPYING](https://github.com/taku910/mecab/blob/master/mecab-ipadic/COPYING).
