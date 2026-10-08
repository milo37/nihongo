import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

class UniqueKeyJsonParser {
  #index = 0
  #source

  constructor(source) {
    this.#source = source
  }

  parse() {
    this.#skipWhitespace()
    const value = this.#parseValue(0)
    this.#skipWhitespace()
    if (this.#index !== this.#source.length) this.#invalid()
    return value
  }

  #invalid() {
    throw new Error('JSON input is invalid or ambiguous.')
  }

  #skipWhitespace() {
    while (' \t\n\r'.includes(this.#source[this.#index] ?? 'x')) {
      this.#index += 1
    }
  }

  #parseValue(depth) {
    if (depth > 100) this.#invalid()
    const character = this.#source[this.#index]
    if (character === '{') return this.#parseObject(depth + 1)
    if (character === '[') return this.#parseArray(depth + 1)
    if (character === '"') return this.#parseString()
    if (character === 't') return this.#parseKeyword('true', true)
    if (character === 'f') return this.#parseKeyword('false', false)
    if (character === 'n') return this.#parseKeyword('null', null)
    if (character === '-' || /[0-9]/u.test(character ?? '')) {
      return this.#parseNumber()
    }
    return this.#invalid()
  }

  #parseKeyword(keyword, value) {
    if (
      this.#source.slice(this.#index, this.#index + keyword.length) !== keyword
    ) {
      this.#invalid()
    }
    this.#index += keyword.length
    return value
  }

  #parseString() {
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
          if (!/^[0-9a-f]{4}$/iu.test(hexadecimal)) this.#invalid()
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
        try {
          return JSON.parse(this.#source.slice(start, this.#index))
        } catch {
          return this.#invalid()
        }
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        this.#invalid()
      }
      this.#index += 1
    }
    return this.#invalid()
  }

  #parseNumber() {
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.#source.slice(this.#index)
    )?.[0]
    if (!token) return this.#invalid()
    this.#index += token.length
    const value = Number(token)
    if (!Number.isFinite(value)) this.#invalid()
    return value
  }

  #parseArray(depth) {
    this.#index += 1
    this.#skipWhitespace()
    const values = []
    if (this.#source[this.#index] === ']') {
      this.#index += 1
      return values
    }
    while (true) {
      this.#skipWhitespace()
      values.push(this.#parseValue(depth))
      this.#skipWhitespace()
      const delimiter = this.#source[this.#index]
      this.#index += 1
      if (delimiter === ']') return values
      if (delimiter !== ',') this.#invalid()
    }
  }

  #parseObject(depth) {
    this.#index += 1
    this.#skipWhitespace()
    const value = {}
    const keys = new Set()
    if (this.#source[this.#index] === '}') {
      this.#index += 1
      return value
    }
    while (true) {
      this.#skipWhitespace()
      if (this.#source[this.#index] !== '"') this.#invalid()
      const key = this.#parseString()
      if (keys.has(key)) {
        throw new Error('JSON input contains a duplicate object key.')
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
      const delimiter = this.#source[this.#index]
      this.#index += 1
      if (delimiter === '}') return value
      if (delimiter !== ',') this.#invalid()
    }
  }
}

export const parseUniqueKeyJson = (source) => {
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('JSON input must be a non-empty string.')
  }
  return new UniqueKeyJsonParser(source).parse()
}

export const parseUniqueKeyJsonBytes = (bytes) => {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw new Error('JSON input cannot contain a byte-order mark.')
  }
  let source
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('JSON input must be valid UTF-8.')
  }
  return parseUniqueKeyJson(source)
}

export const readBoundedUniqueKeyJsonFile = (
  path,
  { label = 'JSON input', maximumBytes = 1_048_576 } = {}
) => {
  if (
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1
  ) {
    throw new Error(`${label} must be a bounded regular JSON file.`)
  }

  let descriptor
  try {
    descriptor = openSync(
      resolve(path),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const metadata = fstatSync(descriptor)
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > maximumBytes
    ) {
      throw new Error(`${label} must be a bounded regular file.`)
    }

    const input = Buffer.allocUnsafe(maximumBytes + 1)
    let totalBytes = 0
    while (totalBytes < input.length) {
      const bytesRead = readSync(
        descriptor,
        input,
        totalBytes,
        input.length - totalBytes,
        null
      )
      if (bytesRead === 0) break
      totalBytes += bytesRead
    }
    if (totalBytes === 0 || totalBytes > maximumBytes) {
      throw new Error(`${label} exceeds the input boundary.`)
    }
    return parseUniqueKeyJsonBytes(input.subarray(0, totalBytes))
  } catch {
    throw new Error(`${label} must be a bounded regular JSON file.`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
