import { createHmac, timingSafeEqual } from 'node:crypto'

const DEVELOPMENT_COOKIE_NAME = 'nihongo.session_token'
const PRODUCTION_COOKIE_NAME = '__Secure-nihongo.session_token'
const MAX_COOKIE_VALUE_LENGTH = 4_096
const BETTER_CALL_SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{43}=$/

const cookieName = (isProduction: boolean): string =>
  isProduction ? PRODUCTION_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME

const sign = (token: string, secret: string): string =>
  createHmac('sha256', secret).update(token, 'utf8').digest('base64')

export const createPhase7SessionCookie = ({
  expiresAt,
  isProduction,
  now = new Date(),
  secret,
  token
}: {
  expiresAt: Date
  isProduction: boolean
  now?: Date
  secret: string
  token: string
}): string => {
  const signedValue = encodeURIComponent(`${token}.${sign(token, secret)}`)
  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - now.getTime()) / 1_000)
  )
  const secure = isProduction ? '; Secure' : ''

  return `${cookieName(isProduction)}=${signedValue}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`
}

export const createExpiredPhase7SessionCookies = (
  isProduction: boolean
): readonly string[] => {
  const attributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    isProduction ? '; Secure' : ''
  }`
  return [
    `${DEVELOPMENT_COOKIE_NAME}=; ${attributes}`,
    `${PRODUCTION_COOKIE_NAME}=; ${attributes}`
  ]
}

export const readPhase7SessionToken = ({
  cookieHeader,
  isProduction,
  secret
}: {
  cookieHeader: string | null
  isProduction: boolean
  secret: string
}): { present: boolean; token: string | null } => {
  if (!cookieHeader) {
    return { present: false, token: null }
  }

  const expectedName = cookieName(isProduction)
  const matches = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${expectedName}=`))
  if (matches.length === 0) {
    return { present: false, token: null }
  }
  if (matches.length !== 1) {
    return { present: true, token: null }
  }

  const encodedValue = matches[0]!.slice(expectedName.length + 1)
  if (!encodedValue || encodedValue.length > MAX_COOKIE_VALUE_LENGTH) {
    return { present: true, token: null }
  }

  let signedValue: string
  try {
    signedValue = decodeURIComponent(encodedValue)
  } catch {
    return { present: true, token: null }
  }
  const separator = signedValue.lastIndexOf('.')
  if (separator <= 0) {
    return { present: true, token: null }
  }

  const token = signedValue.slice(0, separator)
  const signature = signedValue.slice(separator + 1)
  if (!BETTER_CALL_SIGNATURE_PATTERN.test(signature)) {
    return { present: true, token: null }
  }
  const providedSignature = Buffer.from(signature, 'base64')
  const expectedSignature = Buffer.from(sign(token, secret), 'base64')
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return { present: true, token: null }
  }

  return { present: true, token }
}
