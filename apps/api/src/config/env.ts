import { isIP } from 'node:net'
import { z } from 'zod'

const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent'])
const runtimeEnvironmentSchema = z.enum(['development', 'test', 'production'])
const adminCmsModeSchema = z.enum(['disabled', 'technical'])
const emailDeliveryModeSchema = z.enum(['test-sink', 'webhook'])
const secretSchema = z.string().min(32)
const postgresSchemaPattern = /^[a-z_][a-z0-9_]*$/
const releaseIdSchema = z.string().regex(/^[0-9a-f]{40}$/u)

export const LOCAL_RELEASE_ID = '0000000000000000000000000000000000000000'

const toUrlOrNull = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const databaseLoginContract = (
  value: string,
  roleSuffix: 'legacy_app_login' | 'app_login' | 'auth_gateway_login'
): { configured: string; expected: string | null } | null => {
  const url = toUrlOrNull(value)
  if (!url) return null
  let database: string
  let configured: string
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ''))
    configured = decodeURIComponent(url.username)
  } catch {
    return null
  }
  const prefix = database.endsWith('_test')
    ? 'nihongo_test'
    : database.endsWith('_dev')
      ? 'nihongo_development'
      : null
  const expected = prefix ? `${prefix}_${roleSuffix}` : null
  return { configured, expected }
}

const hasSingleSafePostgresSchema = (value: string): boolean => {
  const url = toUrlOrNull(value)
  if (!url) return false
  const schemas = url.searchParams.getAll('schema')
  const parameters = Array.from(url.searchParams.keys())
  return (
    schemas.length === 1 &&
    parameters.length === 1 &&
    parameters[0] === 'schema' &&
    postgresSchemaPattern.test(schemas[0] ?? '')
  )
}

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
    RELEASE_ID: releaseIdSchema,
    ADMIN_CMS_MODE: adminCmsModeSchema,
    HOST: z.string().min(1),
    PORT: z.coerce.number().int().min(1).max(65_535),
    DATABASE_URL: postgresUrlSchema,
    AUTH_GATEWAY_DATABASE_URL: postgresUrlSchema.optional(),
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
    if (
      environment.ADMIN_CMS_MODE === 'technical' &&
      environment.NODE_ENV === 'production'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_CMS_MODE'],
        message: 'technical admin CMS mode는 test/development에서만 허용됩니다.'
      })
    }

    if (
      environment.ADMIN_CMS_MODE === 'technical' &&
      !environment.AUTH_GATEWAY_DATABASE_URL
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_GATEWAY_DATABASE_URL'],
        message:
          'technical admin CMS mode는 분리된 auth gateway DB URL이 필요합니다.'
      })
    }

    if (environment.ADMIN_CMS_MODE === 'technical') {
      for (const [field, roleSuffix] of [
        ['DATABASE_URL', 'app_login'],
        ['AUTH_GATEWAY_DATABASE_URL', 'auth_gateway_login']
      ] as const) {
        const value = environment[field]
        if (value && !hasSingleSafePostgresSchema(value)) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'technical DB URL은 하나의 safe schema를 명시해야 합니다.'
          })
        }
        if (value) {
          const login = databaseLoginContract(value, roleSuffix)
          if (
            login === null ||
            login.expected === null ||
            login.configured !== login.expected
          ) {
            context.addIssue({
              code: 'custom',
              path: [field],
              message:
                'technical DB URL은 환경·역할 전용 wrapper login이 필요합니다.'
            })
          }
        }
      }
    }

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

    if (environment.RELEASE_ID === LOCAL_RELEASE_ID) {
      context.addIssue({
        code: 'custom',
        path: ['RELEASE_ID'],
        message: 'production release ID는 로컬 sentinel일 수 없습니다.'
      })
    }

    const databaseUrl = toUrlOrNull(environment.DATABASE_URL)
    if (!databaseUrl) return
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

    if (environment.TRUSTED_ORIGINS.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['TRUSTED_ORIGINS'],
        message: 'production은 auth URL과 같은 하나의 origin만 허용합니다.'
      })
    }

    if (
      environment.AUTH_EMAIL_DELIVERY_MODE !== 'webhook' ||
      !environment.AUTH_EMAIL_WEBHOOK_URL ||
      !environment.AUTH_EMAIL_WEBHOOK_SECRET ||
      toUrlOrNull(environment.AUTH_EMAIL_WEBHOOK_URL)?.protocol !== 'https:'
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

type ParsedApiEnvironment = z.output<typeof apiEnvironmentSchema>

// Directly constructed test/application dependency fixtures from the pre-Phase
// 7 surface remain valid; absence is the same fail-closed value as the parser's
// explicit `disabled` default.
export type ApiEnvironment = Omit<
  ParsedApiEnvironment,
  'ADMIN_CMS_MODE' | 'RELEASE_ID'
> & {
  readonly ADMIN_CMS_MODE?: ParsedApiEnvironment['ADMIN_CMS_MODE']
  readonly RELEASE_ID?: ParsedApiEnvironment['RELEASE_ID']
}

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
    RELEASE_ID:
      source.RELEASE_ID ??
      (canUseDevelopmentDefaults ? LOCAL_RELEASE_ID : undefined),
    ADMIN_CMS_MODE: source.ADMIN_CMS_MODE ?? 'disabled',
    HOST: source.HOST ?? (canUseDevelopmentDefaults ? '127.0.0.1' : undefined),
    PORT: source.PORT ?? (canUseDevelopmentDefaults ? '3001' : undefined),
    DATABASE_URL: source.DATABASE_URL,
    AUTH_GATEWAY_DATABASE_URL: source.AUTH_GATEWAY_DATABASE_URL,
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
