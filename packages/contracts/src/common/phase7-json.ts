export type Phase7JsonFailureKind = 'INVALID_JSON' | 'MAX_DEPTH_EXCEEDED'

interface FatalTextDecoder {
  decode(input?: Uint8Array): string
}

interface FatalTextDecoderConstructor {
  new (label?: string, options?: { fatal?: boolean }): FatalTextDecoder
}

export class Phase7JsonParseError extends Error {
  readonly kind: Phase7JsonFailureKind

  constructor(kind: Phase7JsonFailureKind) {
    super(
      kind === 'MAX_DEPTH_EXCEEDED'
        ? 'Phase 7 JSON exceeds the maximum container depth.'
        : 'Phase 7 JSON is malformed or contains a duplicate object member.'
    )
    this.name = 'Phase7JsonParseError'
    this.kind = kind
  }
}

class StrictJsonParser {
  private index = 0
  private maximumDepthExceeded = false

  constructor(
    private readonly source: string,
    private readonly maximumDepth: number
  ) {}

  parse(): unknown {
    const maximumDepthExceeded = this.validateIteratively()
    this.index = 0
    if (maximumDepthExceeded) {
      throw new Phase7JsonParseError('MAX_DEPTH_EXCEEDED')
    }
    this.skipWhitespace()
    const value = this.parseValue(0)
    this.skipWhitespace()
    if (this.index !== this.source.length) {
      throw new Phase7JsonParseError('INVALID_JSON')
    }
    if (this.maximumDepthExceeded) {
      throw new Phase7JsonParseError('MAX_DEPTH_EXCEEDED')
    }
    return value
  }

  private validateIteratively(): boolean {
    type Frame =
      | {
          kind: 'ARRAY'
          state: 'VALUE_OR_END' | 'VALUE' | 'COMMA_OR_END'
        }
      | {
          keys: Set<string>
          kind: 'OBJECT'
          state: 'KEY_OR_END' | 'KEY' | 'COLON' | 'VALUE' | 'COMMA_OR_END'
        }

    const stack: Frame[] = []
    let rootAssigned = false
    let maximumDepthExceeded = false

    const fail = (): never => {
      throw new Phase7JsonParseError('INVALID_JSON')
    }
    const acceptValue = (): void => {
      const frame = stack.at(-1)
      if (!frame) {
        if (rootAssigned) fail()
        rootAssigned = true
        return
      }
      if (frame.kind === 'ARRAY') {
        if (frame.state !== 'VALUE_OR_END' && frame.state !== 'VALUE') fail()
      } else if (frame.state !== 'VALUE') {
        fail()
      }
      frame.state = 'COMMA_OR_END'
    }
    const push = (frame: Frame): void => {
      stack.push(frame)
      if (stack.length > this.maximumDepth) maximumDepthExceeded = true
    }
    const consumeValue = (): void => {
      const character = this.source[this.index]
      if (character === '{') {
        acceptValue()
        this.index += 1
        push({ kind: 'OBJECT', keys: new Set<string>(), state: 'KEY_OR_END' })
        return
      }
      if (character === '[') {
        acceptValue()
        this.index += 1
        push({ kind: 'ARRAY', state: 'VALUE_OR_END' })
        return
      }
      if (character === '"') this.parseString()
      else if (character === 't') this.parseLiteral('true', true)
      else if (character === 'f') this.parseLiteral('false', false)
      else if (character === 'n') this.parseLiteral('null', null)
      else this.parseNumber()
      acceptValue()
    }

    while (true) {
      this.skipWhitespace()
      const frame = stack.at(-1)
      if (!frame) {
        if (!rootAssigned) {
          consumeValue()
          continue
        }
        if (this.index !== this.source.length) fail()
        return maximumDepthExceeded
      }

      if (frame.kind === 'ARRAY') {
        if (frame.state === 'VALUE_OR_END' && this.source[this.index] === ']') {
          this.index += 1
          stack.pop()
        } else if (frame.state === 'VALUE_OR_END' || frame.state === 'VALUE') {
          consumeValue()
        } else if (this.source[this.index] === ',') {
          this.index += 1
          frame.state = 'VALUE'
        } else if (this.source[this.index] === ']') {
          this.index += 1
          stack.pop()
        } else {
          fail()
        }
        continue
      }

      if (frame.state === 'KEY_OR_END' && this.source[this.index] === '}') {
        this.index += 1
        stack.pop()
      } else if (frame.state === 'KEY_OR_END' || frame.state === 'KEY') {
        if (this.source[this.index] !== '"') fail()
        const key = this.parseString()
        if (frame.keys.has(key)) fail()
        frame.keys.add(key)
        frame.state = 'COLON'
      } else if (frame.state === 'COLON') {
        if (this.source[this.index] !== ':') fail()
        this.index += 1
        frame.state = 'VALUE'
      } else if (frame.state === 'VALUE') {
        consumeValue()
      } else if (this.source[this.index] === ',') {
        this.index += 1
        frame.state = 'KEY'
      } else if (this.source[this.index] === '}') {
        this.index += 1
        stack.pop()
      } else {
        fail()
      }
    }
  }

  private parseValue(depth: number): unknown {
    const character = this.source[this.index]
    if (character === '{') return this.parseObject(depth + 1)
    if (character === '[') return this.parseArray(depth + 1)
    if (character === '"') return this.parseString()
    if (character === 't') return this.parseLiteral('true', true)
    if (character === 'f') return this.parseLiteral('false', false)
    if (character === 'n') return this.parseLiteral('null', null)
    return this.parseNumber()
  }

  private assertDepth(depth: number): void {
    if (depth > this.maximumDepth) {
      this.maximumDepthExceeded = true
    }
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.assertDepth(depth)
    this.index += 1
    this.skipWhitespace()
    const value = Object.create(null) as Record<string, unknown>
    const keys = new Set<string>()
    if (this.source[this.index] === '}') {
      this.index += 1
      return value
    }

    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') {
        throw new Phase7JsonParseError('INVALID_JSON')
      }
      const key = this.parseString()
      if (keys.has(key)) {
        throw new Phase7JsonParseError('INVALID_JSON')
      }
      keys.add(key)
      this.skipWhitespace()
      if (this.source[this.index] !== ':') {
        throw new Phase7JsonParseError('INVALID_JSON')
      }
      this.index += 1
      this.skipWhitespace()
      value[key] = this.parseValue(depth)
      this.skipWhitespace()
      const separator = this.source[this.index]
      if (separator === '}') {
        this.index += 1
        return value
      }
      if (separator !== ',') {
        throw new Phase7JsonParseError('INVALID_JSON')
      }
      this.index += 1
      this.skipWhitespace()
    }
    throw new Phase7JsonParseError('INVALID_JSON')
  }

  private parseArray(depth: number): unknown[] {
    this.assertDepth(depth)
    this.index += 1
    this.skipWhitespace()
    const value: unknown[] = []
    if (this.source[this.index] === ']') {
      this.index += 1
      return value
    }

    while (this.index < this.source.length) {
      value.push(this.parseValue(depth))
      this.skipWhitespace()
      const separator = this.source[this.index]
      if (separator === ']') {
        this.index += 1
        return value
      }
      if (separator !== ',') {
        throw new Phase7JsonParseError('INVALID_JSON')
      }
      this.index += 1
      this.skipWhitespace()
    }
    throw new Phase7JsonParseError('INVALID_JSON')
  }

  private parseString(): string {
    const start = this.index
    this.index += 1
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index)
      if (code === 0x22) {
        this.index += 1
        try {
          return JSON.parse(this.source.slice(start, this.index)) as string
        } catch {
          throw new Phase7JsonParseError('INVALID_JSON')
        }
      }
      if (code < 0x20) {
        throw new Phase7JsonParseError('INVALID_JSON')
      }
      if (code === 0x5c) {
        this.index += 1
        const escaped = this.source[this.index]
        if (escaped === 'u') {
          const hexadecimal = this.source.slice(this.index + 1, this.index + 5)
          if (!/^[0-9a-f]{4}$/iu.test(hexadecimal)) {
            throw new Phase7JsonParseError('INVALID_JSON')
          }
          this.index += 5
          continue
        }
        if (!escaped || !'"\\/bfnrt'.includes(escaped)) {
          throw new Phase7JsonParseError('INVALID_JSON')
        }
      }
      this.index += 1
    }
    throw new Phase7JsonParseError('INVALID_JSON')
  }

  private parseLiteral<Value>(literal: string, value: Value): Value {
    if (
      this.source.slice(this.index, this.index + literal.length) !== literal
    ) {
      throw new Phase7JsonParseError('INVALID_JSON')
    }
    this.index += literal.length
    return value
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.source.slice(this.index)
    )
    if (!match) {
      throw new Phase7JsonParseError('INVALID_JSON')
    }
    this.index += match[0].length
    return Number(match[0])
  }

  private skipWhitespace(): void {
    while (
      this.source[this.index] === ' ' ||
      this.source[this.index] === '\n' ||
      this.source[this.index] === '\r' ||
      this.source[this.index] === '\t'
    ) {
      this.index += 1
    }
  }
}

export const parsePhase7JsonBytes = (
  bytes: Uint8Array,
  options: { maximumDepth?: number } = {}
): unknown => {
  let source: string
  try {
    const TextDecoderConstructor = (
      globalThis as unknown as { TextDecoder: FatalTextDecoderConstructor }
    ).TextDecoder
    source = new TextDecoderConstructor('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Phase7JsonParseError('INVALID_JSON')
  }
  return new StrictJsonParser(source, options.maximumDepth ?? 12).parse()
}
