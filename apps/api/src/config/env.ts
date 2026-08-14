import { isIP } from 'node:net'
import { z } from 'zod'

const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent'])
const runtimeEnvironmentSchema = z.enum(['development', 'test', 'production'])
const emailDeliveryModeSchema = z.enum(['test-sink', 'webhook'])
const secretSchema = z.string().min(32)

const trustedProxyListSchema = z.string().transform((value, context) => {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  for (const entry of entries) {
    const [address, prefix, ...rest] = entry.split('/')
    const family = address ? isIP(address) : 0
    const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : -1
    const parsedPrefix = prefix === undefined ? maxPrefix : Number(prefix)
    if (
      rest.length > 0 ||
      maxPrefix < 0 ||
      !Number.isInteger(parsedPrefix) ||
      parsedPrefix < 0 ||
      parsedPrefix > maxPrefix
    ) {
      context.addIssue({
        code: 'custom',
        message: 'trusted proxy는 유효한 IP 또는 CIDR이어야 합니다.'
      })
      return z.NEVER
    }
  }

  return [...new Set(entries)]
})

const postgresUrlSchema = z.url().superRefine((value, context) => {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    context.addIssue({
      code: 'custom',
      message: 'PostgreSQL URL이 필요합니다.'
    })
  }
})

const originListSchema = z.string().transform((value, context) => {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  if (origins.length === 0) {
    context.addIssue({
      code: 'custom',
      message: '하나 이상의 trusted origin이 필요합니다.'
    })
    return z.NEVER
  }

  const normalizedOrigins: string[] = []

  for (const origin of origins) {
    try {
      const url = new URL(origin)
      const isHttpOrigin = url.protocol === 'http:' || url.protocol === 'https:'
      const isExactOrigin =
        url.origin !== 'null' &&
        url.username.length === 0 &&
        url.password.length === 0 &&
        !url.hostname.includes('*') &&
        url.pathname === '/' &&
        url.search.length === 0 &&
        url.hash.length === 0

      if (!isHttpOrigin || !isExactOrigin) {
        throw new Error('Invalid trusted origin.')
      }

      normalizedOrigins.push(url.origin)
    } catch {
      context.addIssue({
        code: 'custom',
        message:
          'trusted origin은 credential과 wildcard가 없는 http(s) exact origin이어야 합니다.'
      })
      return z.NEVER
    }
  }

  return [...new Set(normalizedOrigins)]
})

const exactOriginSchema = z.url().transform((value, context) => {
  const url = new URL(value)
  const isHttpOrigin = url.protocol === 'http:' || url.protocol === 'https:'
  const isExactOrigin =
    url.origin !== 'null' &&
    url.username.length === 0 &&
    url.password.length === 0 &&
    url.pathname === '/' &&
    url.search.length === 0 &&
    url.hash.length === 0

  if (!isHttpOrigin || !isExactOrigin) {
    context.addIssue({
      code: 'custom',
      message: 'credential이 없는 http(s) exact origin이어야 합니다.'
    })
    return z.NEVER
  }

  return url.origin
})

const apiEnvironmentSchema = z
  .object({
    NODE_ENV: runtimeEnvironmentSchema,
    HOST: z.string().min(1),
    PORT: z.coerce.number().int().min(1).max(65_535),
    DATABASE_URL: postgresUrlSchema,
    TRUSTED_ORIGINS: originListSchema,
    LOG_LEVEL: logLevelSchema,
    BETTER_AUTH_SECRET: secretSchema,
    BETTER_AUTH_URL: exactOriginSchema,
    GUEST_COOKIE_SECRET: secretSchema,
    AUTH_EMAIL_FROM: z.email(),
    AUTH_EMAIL_DELIVERY_MODE: emailDeliveryModeSchema,
    AUTH_EMAIL_WEBHOOK_URL: z.url().optional(),
    AUTH_EMAIL_WEBHOOK_SECRET: secretSchema.optional(),
    AUTH_TRUSTED_PROXY_CIDRS: trustedProxyListSchema
  })
  .strict()
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') {
      if (environment.BETTER_AUTH_SECRET === environment.GUEST_COOKIE_SECRET) {
        context.addIssue({
          code: 'custom',
          path: ['GUEST_COOKIE_SECRET'],
          message: 'guest cookie secret은 auth secret과 달라야 합니다.'
        })
      }
      return
    }

    const databaseUrl = new URL(environment.DATABASE_URL)
    const sslModes = databaseUrl.searchParams.getAll('sslmode')
    const sslMode = sslModes[0]?.toLowerCase()

    if (
      sslModes.length !== 1 ||
      !['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'production PostgreSQL은 TLS가 필요합니다.'
      })
    }

    for (const origin of environment.TRUSTED_ORIGINS) {
      if (new URL(origin).protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          path: ['TRUSTED_ORIGINS'],
          message: 'production trusted origin은 https여야 합니다.'
        })
      }
    }

    if (new URL(environment.BETTER_AUTH_URL).protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message: 'production auth URL은 https여야 합니다.'
      })
    }

    if (!environment.TRUSTED_ORIGINS.includes(environment.BETTER_AUTH_URL)) {
      context.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message: 'production auth URL은 trusted origins에 포함돼야 합니다.'
      })
    }

    if (
      environment.AUTH_EMAIL_DELIVERY_MODE !== 'webhook' ||
      !environment.AUTH_EMAIL_WEBHOOK_URL ||
      !environment.AUTH_EMAIL_WEBHOOK_SECRET ||
      new URL(environment.AUTH_EMAIL_WEBHOOK_URL).protocol !== 'https:'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_EMAIL_DELIVERY_MODE'],
        message: 'production email은 HTTPS webhook adapter가 필요합니다.'
      })
    }

    if (environment.AUTH_TRUSTED_PROXY_CIDRS.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_TRUSTED_PROXY_CIDRS'],
        message: 'production ingress proxy CIDR을 명시해야 합니다.'
      })
    }

    if (environment.BETTER_AUTH_SECRET === environment.GUEST_COOKIE_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['GUEST_COOKIE_SECRET'],
        message: 'guest cookie secret은 auth secret과 달라야 합니다.'
      })
    }
  })

export type ApiEnvironment = z.output<typeof apiEnvironmentSchema>

export class EnvironmentValidationError extends Error {
  readonly invalidFields: readonly string[]

  constructor(invalidFields: readonly string[]) {
    super(`API environment validation failed: ${invalidFields.join(', ')}`)
    this.name = 'EnvironmentValidationError'
    this.invalidFields = invalidFields
  }
}

export const parseApiEnvironment = (
  source: NodeJS.ProcessEnv
): ApiEnvironment => {
  const runtimeEnvironment = runtimeEnvironmentSchema.safeParse(source.NODE_ENV)
  const canUseDevelopmentDefaults =
    runtimeEnvironment.success && runtimeEnvironment.data !== 'production'
  const parsed = apiEnvironmentSchema.safeParse({
    NODE_ENV: source.NODE_ENV,
    HOST: source.HOST ?? (canUseDevelopmentDefaults ? '127.0.0.1' : undefined),
    PORT: source.PORT ?? (canUseDevelopmentDefaults ? '3001' : undefined),
    DATABASE_URL: source.DATABASE_URL,
    TRUSTED_ORIGINS:
      source.TRUSTED_ORIGINS ??
      (canUseDevelopmentDefaults ? 'http://localhost:5173' : undefined),
    LOG_LEVEL:
      source.LOG_LEVEL ?? (canUseDevelopmentDefaults ? 'info' : undefined),
    BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL:
      source.BETTER_AUTH_URL ??
      (canUseDevelopmentDefaults ? 'http://localhost:3001' : undefined),
    GUEST_COOKIE_SECRET: source.GUEST_COOKIE_SECRET,
    AUTH_EMAIL_FROM: source.AUTH_EMAIL_FROM,
    AUTH_EMAIL_DELIVERY_MODE:
      source.AUTH_EMAIL_DELIVERY_MODE ??
      (canUseDevelopmentDefaults ? 'test-sink' : undefined),
    AUTH_EMAIL_WEBHOOK_URL: source.AUTH_EMAIL_WEBHOOK_URL,
    AUTH_EMAIL_WEBHOOK_SECRET: source.AUTH_EMAIL_WEBHOOK_SECRET,
    AUTH_TRUSTED_PROXY_CIDRS:
      source.AUTH_TRUSTED_PROXY_CIDRS ??
      (canUseDevelopmentDefaults ? '127.0.0.1/32,::1/128' : undefined)
  })

  if (parsed.success) {
    return parsed.data
  }

  const invalidFields = [
    ...new Set(
      parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? issue.path.join('.') : 'environment'
      )
    )
  ]

  throw new EnvironmentValidationError(invalidFields)
}
