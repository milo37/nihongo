import { z, type ZodError, type ZodType } from 'zod'
import { ApplicationError } from '../errors/applicationError.js'

const RESERVED_QUERY_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MALFORMED_PERCENT_PATTERN = /%(?![0-9a-f]{2})/iu

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'query'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }

  return fieldErrors
}

const decodeQueryComponent = (value: string): string => {
  if (MALFORMED_PERCENT_PATTERN.test(value)) {
    throw new Error('Malformed percent encoding.')
  }

  const formValue = value.replaceAll('+', ' ')
  const bytes: number[] = []

  for (let index = 0; index < formValue.length; index += 1) {
    const unit = formValue.charCodeAt(index)
    if (unit === 0x25) {
      bytes.push(Number.parseInt(formValue.slice(index + 1, index + 3), 16))
      index += 2
      continue
    }

    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = formValue.charCodeAt(index + 1)
      if (trailing < 0xdc00 || trailing > 0xdfff) {
        throw new Error('Unpaired surrogate in raw query.')
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error('Unpaired surrogate in raw query.')
    }

    const codePoint = formValue.codePointAt(index)
    if (codePoint === undefined) throw new Error('Invalid query code point.')
    const character = String.fromCodePoint(codePoint)
    const encoded = new TextEncoder().encode(character)
    bytes.push(...encoded)
    if (character.length === 2) index += 1
  }

  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(bytes)
  )
}

export type RawQueryRecord = Record<string, readonly string[]>

export const parseRawQueryRecord = (requestTarget: string): RawQueryRecord => {
  const queryStart = requestTarget.indexOf('?')
  const record = Object.create(null) as Record<string, string[]>
  if (queryStart < 0) {
    return record
  }

  const fragmentStart = requestTarget.indexOf('#', queryStart + 1)
  const rawQuery = requestTarget.slice(
    queryStart + 1,
    fragmentStart < 0 ? requestTarget.length : fragmentStart
  )
  if (rawQuery.length === 0) {
    return record
  }

  for (const pair of rawQuery.split('&')) {
    const separator = pair.indexOf('=')
    const rawKey = separator < 0 ? pair : pair.slice(0, separator)
    const rawValue = separator < 0 ? '' : pair.slice(separator + 1)
    const key = decodeQueryComponent(rawKey)
    const value = decodeQueryComponent(rawValue)

    if (key.length === 0 || RESERVED_QUERY_KEYS.has(key)) {
      throw new Error('Reserved or empty query key.')
    }

    const values = record[key] ?? []
    values.push(value)
    record[key] = values
  }

  return record
}

export const parseStrictRawQuery = <Schema extends ZodType>(
  requestTarget: string,
  schema: Schema,
  message: string
): z.output<Schema> => {
  let raw: RawQueryRecord
  try {
    raw = parseRawQueryRecord(requestTarget)
  } catch {
    throw new ApplicationError({
      code: 'VALIDATION_ERROR',
      message,
      fieldErrors: { query: ['쿼리 문자열이 올바르지 않습니다.'] },
      retryable: false
    })
  }

  const scalars = Object.create(null) as Record<string, string>
  for (const [key, values] of Object.entries(raw)) {
    if (values.length !== 1) {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message,
        fieldErrors: { [key]: ['중복 쿼리 키는 허용되지 않습니다.'] },
        retryable: false
      })
    }
    scalars[key] = values[0]!
  }

  const result = schema.safeParse(scalars)
  if (!result.success) {
    throw new ApplicationError({
      code: 'VALIDATION_ERROR',
      message,
      fieldErrors: toFieldErrors(result.error),
      retryable: false
    })
  }

  return result.data
}
