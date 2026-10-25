import { isNfc, isWellFormedUnicode } from './unicode.js'

export type CanonicalJsonPrimitive = null | boolean | number | string
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue }

export type CanonicalJsonErrorCode =
  | 'CYCLE'
  | 'INVALID_NUMBER'
  | 'INVALID_OBJECT'
  | 'INVALID_STRING'
  | 'UNSUPPORTED_VALUE'

export class CanonicalJsonError extends Error {
  readonly code: CanonicalJsonErrorCode

  constructor(code: CanonicalJsonErrorCode, message: string) {
    super(message)
    this.name = 'CanonicalJsonError'
    this.code = code
  }
}

const serializeString = (value: string): string => {
  if (!isWellFormedUnicode(value) || !isNfc(value)) {
    throw new CanonicalJsonError(
      'INVALID_STRING',
      'canonical JSON 문자열은 well-formed NFC Unicode여야 합니다.'
    )
  }
  return JSON.stringify(value)
}

const assertPlainObject = (value: object): void => {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(
      'INVALID_OBJECT',
      'canonical JSON은 plain object만 허용합니다.'
    )
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonicalJsonError(
      'INVALID_OBJECT',
      'canonical JSON object는 symbol key를 허용하지 않습니다.'
    )
  }
  const propertyNames = Object.getOwnPropertyNames(value)
  if (
    propertyNames.length !== Object.keys(value).length ||
    propertyNames.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor === undefined || !('value' in descriptor)
    })
  ) {
    throw new CanonicalJsonError(
      'INVALID_OBJECT',
      'canonical JSON object는 enumerable data property만 허용합니다.'
    )
  }
}

const serialize = (value: unknown, ancestors: Set<object>): string => {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return serializeString(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new CanonicalJsonError(
        'INVALID_NUMBER',
        'canonical JSON number는 -0이 아닌 safe integer여야 합니다.'
      )
    }
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new CanonicalJsonError(
      'UNSUPPORTED_VALUE',
      'canonical JSON이 지원하지 않는 값입니다.'
    )
  }

  if (ancestors.has(value)) {
    throw new CanonicalJsonError('CYCLE', 'canonical JSON cycle을 거부합니다.')
  }
  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      const allowedProperties = new Set([
        'length',
        ...Array.from({ length: value.length }, (_, index) => String(index))
      ])
      if (
        Object.getOwnPropertySymbols(value).length > 0 ||
        Object.getOwnPropertyNames(value).some(
          (property) => !allowedProperties.has(property)
        )
      ) {
        throw new CanonicalJsonError(
          'INVALID_OBJECT',
          'canonical JSON array는 index 외 own property를 허용하지 않습니다.'
        )
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (
          !Object.hasOwn(value, index) ||
          descriptor === undefined ||
          !('value' in descriptor) ||
          !descriptor.enumerable
        ) {
          throw new CanonicalJsonError(
            'INVALID_OBJECT',
            'canonical JSON sparse/accessor array를 거부합니다.'
          )
        }
      }
      return `[${value.map((item) => serialize(item, ancestors)).join(',')}]`
    }

    assertPlainObject(value)
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const properties = keys.map((key) => {
      if (!Object.prototype.propertyIsEnumerable.call(record, key)) {
        throw new CanonicalJsonError(
          'INVALID_OBJECT',
          'canonical JSON은 enumerable property만 허용합니다.'
        )
      }
      return `${serializeString(key)}:${serialize(record[key], ancestors)}`
    })
    return `{${properties.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export const canonicalizeJson = (value: unknown): string =>
  serialize(value, new Set<object>())
