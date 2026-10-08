import { describe, expect, it } from 'vitest'
import { parseStrictJsonBytes, StrictJsonError } from './strictJson.js'

const parse = (value: string): unknown =>
  parseStrictJsonBytes(Buffer.from(value, 'utf8'))

describe('strictJson v1', () => {
  it('parses nested safe-integer JSON without prototype mutation', () => {
    const result = parse(
      '{"__proto__":{"polluted":true},"array":[1,true,null,"日本語"]}'
    ) as Record<string, unknown>
    expect(Object.getPrototypeOf(result)).toBeNull()
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(result.array).toEqual([1, true, null, '日本語'])
  })

  it.each([
    ['decoded duplicate key', '{"a":1,"\\u0061":2}', 'DUPLICATE_KEY'],
    ['negative zero', '-0', 'INVALID_NUMBER'],
    ['fraction', '1.5', 'INVALID_NUMBER'],
    ['exponent', '1e2', 'INVALID_NUMBER'],
    ['unsafe integer', '9007199254740992', 'INVALID_NUMBER'],
    ['leading zero', '01', 'INVALID_JSON'],
    ['CR source', '{\r\n}', 'INVALID_UTF8'],
    ['NFD source', '"e\\u0301"', 'INVALID_STRING'],
    ['lone surrogate', '"\\ud800"', 'INVALID_STRING'],
    ['trailing comma', '[1,]', 'INVALID_JSON']
  ])('rejects %s', (_label, source, code) => {
    try {
      parse(source)
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(StrictJsonError)
      expect((error as StrictJsonError).code).toBe(code)
    }
  })

  it('rejects BOM and malformed UTF-8 before decoding', () => {
    expect(() =>
      parseStrictJsonBytes(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))
    ).toThrowError(StrictJsonError)
    expect(() => parseStrictJsonBytes(Buffer.from([0xc3, 0x28]))).toThrowError(
      StrictJsonError
    )
  })
})
