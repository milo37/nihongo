import {
  isNfc,
  isWellFormedUnicode
} from '@nihongo/domain/content/validators/v1/unicode'

export type StrictJsonErrorCode =
  | 'DUPLICATE_KEY'
  | 'INVALID_JSON'
  | 'INVALID_NUMBER'
  | 'INVALID_STRING'
  | 'INVALID_UTF8'

export class StrictJsonError extends Error {
  readonly code: StrictJsonErrorCode

  constructor(code: StrictJsonErrorCode, message: string) {
    super(message)
    this.name = 'StrictJsonError'
    this.code = code
  }
}

class Parser {
  readonly #source: string
  #index = 0

  constructor(source: string) {
    this.#source = source
  }

  parse(): unknown {
    this.#skipWhitespace()
    const value = this.#parseValue(0)
    this.#skipWhitespace()
    if (this.#index !== this.#source.length) this.#invalid()
    return value
  }

  #invalid(): never {
    throw new StrictJsonError(
      'INVALID_JSON',
      'JSON syntax가 유효하지 않습니다.'
    )
  }

  #skipWhitespace(): void {
    while (this.#index < this.#source.length) {
      const character = this.#source[this.#index]
      if (character !== ' ' && character !== '\t' && character !== '\n') break
      this.#index += 1
    }
  }

  #parseValue(depth: number): unknown {
    if (depth > 100) this.#invalid()
    const character = this.#source[this.#index]
    if (character === '{') return this.#parseObject(depth + 1)
    if (character === '[') return this.#parseArray(depth + 1)
    if (character === '"') return this.#parseString()
    if (character === 't') return this.#parseKeyword('true', true)
    if (character === 'f') return this.#parseKeyword('false', false)
    if (character === 'n') return this.#parseKeyword('null', null)
    if (
      character === '-' ||
      (character !== undefined && /[0-9]/.test(character))
    ) {
      return this.#parseNumber()
    }
    return this.#invalid()
  }

  #parseKeyword<Value>(keyword: string, value: Value): Value {
    if (
      this.#source.slice(this.#index, this.#index + keyword.length) !== keyword
    ) {
      this.#invalid()
    }
    this.#index += keyword.length
    return value
  }

  #parseString(): string {
    const start = this.#index
    this.#index += 1
    let escaped = false

    while (this.#index < this.#source.length) {
      const character = this.#source[this.#index]
      if (escaped) {
        if (character === 'u') {
          const hexadecimal = this.#source.slice(
            this.#index + 1,
            this.#index + 5
          )
          if (!/^[a-fA-F0-9]{4}$/.test(hexadecimal)) this.#invalid()
          this.#index += 5
        } else {
          if (!'"\\/bfnrt'.includes(character ?? '')) this.#invalid()
          this.#index += 1
        }
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        this.#index += 1
        continue
      }
      if (character === '"') {
        this.#index += 1
        const token = this.#source.slice(start, this.#index)
        let value: string
        try {
          value = JSON.parse(token) as string
        } catch {
          return this.#invalid()
        }
        if (!isWellFormedUnicode(value) || !isNfc(value)) {
          throw new StrictJsonError(
            'INVALID_STRING',
            'JSON 문자열은 well-formed NFC Unicode여야 합니다.'
          )
        }
        return value
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        this.#invalid()
      }
      this.#index += 1
    }
    return this.#invalid()
  }

  #parseNumber(): number {
    const start = this.#index
    if (this.#source[this.#index] === '-') this.#index += 1
    const firstDigit = this.#source[this.#index]
    if (firstDigit === '0') {
      this.#index += 1
    } else if (firstDigit !== undefined && /[1-9]/.test(firstDigit)) {
      this.#index += 1
      while (/[0-9]/.test(this.#source[this.#index] ?? '')) {
        this.#index += 1
      }
    } else {
      this.#invalid()
    }
    const next = this.#source[this.#index]
    if (next === '.' || next === 'e' || next === 'E') {
      throw new StrictJsonError(
        'INVALID_NUMBER',
        'JSON number는 decimal safe integer literal이어야 합니다.'
      )
    }
    const token = this.#source.slice(start, this.#index)
    const value = Number(token)
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new StrictJsonError(
        'INVALID_NUMBER',
        'JSON number는 -0이 아닌 safe integer여야 합니다.'
      )
    }
    return value
  }

  #parseArray(depth: number): unknown[] {
    this.#index += 1
    this.#skipWhitespace()
    const values: unknown[] = []
    if (this.#source[this.#index] === ']') {
      this.#index += 1
      return values
    }
    while (true) {
      this.#skipWhitespace()
      values.push(this.#parseValue(depth))
      this.#skipWhitespace()
      const character = this.#source[this.#index]
      this.#index += 1
      if (character === ']') return values
      if (character !== ',') this.#invalid()
    }
  }

  #parseObject(depth: number): Record<string, unknown> {
    this.#index += 1
    this.#skipWhitespace()
    const value: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >
    const keys = new Set<string>()
    if (this.#source[this.#index] === '}') {
      this.#index += 1
      return value
    }
    while (true) {
      this.#skipWhitespace()
      if (this.#source[this.#index] !== '"') this.#invalid()
      const key = this.#parseString()
      if (keys.has(key)) {
        throw new StrictJsonError(
          'DUPLICATE_KEY',
          'decoded JSON object key가 중복됐습니다.'
        )
      }
      keys.add(key)
      this.#skipWhitespace()
      if (this.#source[this.#index] !== ':') this.#invalid()
      this.#index += 1
      this.#skipWhitespace()
      Object.defineProperty(value, key, {
        configurable: true,
        enumerable: true,
        value: this.#parseValue(depth),
        writable: true
      })
      this.#skipWhitespace()
      const character = this.#source[this.#index]
      this.#index += 1
      if (character === '}') return value
      if (character !== ',') this.#invalid()
    }
  }
}

export const parseStrictJsonBytes = (bytes: Uint8Array): unknown => {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw new StrictJsonError('INVALID_UTF8', 'UTF-8 BOM을 허용하지 않습니다.')
  }
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new StrictJsonError('INVALID_UTF8', 'UTF-8 decoding에 실패했습니다.')
  }
  if (source.startsWith('\ufeff') || source.includes('\r')) {
    throw new StrictJsonError(
      'INVALID_UTF8',
      'UTF-8 BOM과 CR line ending을 허용하지 않습니다.'
    )
  }
  if (!isNfc(source) || !isWellFormedUnicode(source)) {
    throw new StrictJsonError(
      'INVALID_STRING',
      'JSON source는 well-formed NFC Unicode여야 합니다.'
    )
  }
  return new Parser(source).parse()
}
