import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseUniqueKeyJson,
  parseUniqueKeyJsonBytes
} from './json-boundary.mjs'

test('unique-key JSON parser accepts complete standard JSON values', () => {
  assert.deepEqual(
    parseUniqueKeyJson(
      '{"array":[null,true,false,-2,1.5,2e3],"nested":{"name":"日本語"}}'
    ),
    {
      array: [null, true, false, -2, 1.5, 2_000],
      nested: { name: '日本語' }
    }
  )
})

test('unique-key JSON parser rejects decoded duplicates at every depth', () => {
  for (const source of [
    '{"environment":"TEST","environment":"PRODUCTION"}',
    '{"outer":{"releaseId":"a","releaseId":"b"}}',
    '{"a":1,"\\u0061":2}'
  ]) {
    assert.throws(() => parseUniqueKeyJson(source), /duplicate object key/u)
  }
})

test('unique-key JSON parser rejects malformed, deep, BOM, and invalid UTF-8 input', () => {
  assert.throws(() => parseUniqueKeyJson('{"a":1,}'), /invalid/u)
  assert.throws(
    () => parseUniqueKeyJson(`${'['.repeat(102)}0${']'.repeat(102)}`),
    /invalid/u
  )
  assert.throws(
    () => parseUniqueKeyJsonBytes(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
    /byte-order mark/u
  )
  assert.throws(
    () => parseUniqueKeyJsonBytes(Buffer.from([0xc3, 0x28])),
    /valid UTF-8/u
  )
})
