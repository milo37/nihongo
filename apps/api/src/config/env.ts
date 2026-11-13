import { isIP } from 'node:net'
import { z } from 'zod'
import {
  hasProductionSslMode,
  PRODUCTION_DATABASE_NAME,
  PRODUCTION_LOGIN_PREFIX
} from '../db/databaseTargetGuard.js'

const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent'])
const runtimeEnvironmentSchema = z.enum(['development', 'test', 'production'])
const deploymentEnvironmentSchema = z.enum([
  'LOCAL',
  'TEST',
  'DEVELOPMENT',
  'STAGING',
  'PRODUCTION'
])
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
  roleSuffix: 'app_login',
  deploymentEnvironment: z.output<typeof deploymentEnvironmentSchema>
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
  // PRODUCTION and STAGING deployments only accept the provisioned nihongo
  // database; no other deployment (including production-shaped TEST smoke)
  // may use it.
  const prefix =
    deploymentEnvironment === 'PRODUCTION' ||
    deploymentEnvironment === 'STAGING'
      ? database === PRODUCTION_DATABASE_NAME
        ? PRODUCTION_LOGIN_PREFIX
        : null
      : database.endsWith('_test')
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
    parameters.every(
      (parameter) => parameter === 'schema' || parameter === 'sslmode'
    ) &&
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
    DEPLOYMENT_ENVIRONMENT: deploymentEnvironmentSchema,
    RELEASE_ID: releaseIdSchema,
    HOST: z.string().min(1),
    PORT: z.coerce.number().int().min(1).max(65_535),
    DATABASE_URL: postgresUrlSchema,
    TRUSTED_ORIGINS: originListSchema,
    LOG_LEVEL: logLevelSchema,
    BETTER_AUTH_SECRET: secretSchema,
    BETTER_AUTH_URL: exactOriginSchema,
    GUEST_COOKIE_SECRET: secretSchema,
    GOOGLE_CLIENT_ID: z.string().trim().min(1).max(512).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).max(4096).optional(),
    APPLE_CLIENT_ID: z.string().trim().min(1).max(512).optional(),
    APPLE_CLIENT_SECRET: z.string().min(1).max(8192).optional(),
    AUTH_TRUSTED_PROXY_CIDRS: trustedProxyListSchema,
    // JLP-788: unset or empty enforces everywhere.
    CSP_MODE: z.enum(['report-only', 'enforce']).optional()
  })
  .strict()
  .superRefine((environment, context) => {
    for (const [id, secret] of [
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      ['APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET']
    ] as const) {
      if (Boolean(environment[id]) !== Boolean(environment[secret])) {
        context.addIssue({
          code: 'custom',
          path: [id],
          message: 'SSO client ID and secret must be configured together.'
        })
      }
    }
    if (environment.APPLE_CLIENT_ID) {
      const callback = new URL(environment.BETTER_AUTH_URL)
      const hostname = callback.hostname
        .replace(/^\[|\]$/gu, '')
        .replace(/\.$/u, '')
      if (
        callback.protocol !== 'https:' ||
        !hostname.includes('.') ||
        isIP(hostname) !== 0 ||
        hostname === 'localhost' ||
        hostname.endsWith('.localhost')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['BETTER_AUTH_URL'],
          message: 'Apple SSO requires an HTTPS domain callback origin.'
        })
      }
    }
    const deploymentEnvironment = environment.DEPLOYMENT_ENVIRONMENT
    if (
      environment.NODE_ENV === 'production' &&
      !['TEST', 'STAGING', 'PRODUCTION'].includes(deploymentEnvironment)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DEPLOYMENT_ENVIRONMENT'],
        message:
          'production-shaped runtime은 TEST, STAGING 또는 PRODUCTION 배포 환경이어야 합니다.'
      })
    }
    if (environment.NODE_ENV === 'test' && deploymentEnvironment !== 'TEST') {
      context.addIssue({
        code: 'custom',
        path: ['DEPLOYMENT_ENVIRONMENT'],
        message: 'test runtime은 TEST 배포 환경이어야 합니다.'
      })
    }
    if (
      environment.NODE_ENV === 'development' &&
      deploymentEnvironment !== 'LOCAL' &&
      deploymentEnvironment !== 'DEVELOPMENT'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DEPLOYMENT_ENVIRONMENT'],
        message: 'development runtime은 LOCAL 또는 DEVELOPMENT여야 합니다.'
      })
    }

    // Every runtime uses its environment's wrapper login and one schema.
    for (const [field, roleSuffix] of [
      ['DATABASE_URL', 'app_login']
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
        const login = databaseLoginContract(
          value,
          roleSuffix,
          environment.DEPLOYMENT_ENVIRONMENT
        )
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
    if (!hasProductionSslMode(databaseUrl)) {
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

// Directly constructed test/application dependency fixtures may omit the
// deployment environment and release id.
export type ApiEnvironment = Omit<
  ParsedApiEnvironment,
  'DEPLOYMENT_ENVIRONMENT' | 'RELEASE_ID'
> & {
  readonly DEPLOYMENT_ENVIRONMENT?: ParsedApiEnvironment['DEPLOYMENT_ENVIRONMENT']
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
    DEPLOYMENT_ENVIRONMENT:
      source.DEPLOYMENT_ENVIRONMENT ??
      (runtimeEnvironment.success && runtimeEnvironment.data === 'test'
        ? 'TEST'
        : runtimeEnvironment.success &&
            runtimeEnvironment.data === 'development'
          ? 'LOCAL'
          : undefined),
    RELEASE_ID:
      source.RELEASE_ID ??
      (canUseDevelopmentDefaults ? LOCAL_RELEASE_ID : undefined),
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
    GOOGLE_CLIENT_ID: source.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: source.GOOGLE_CLIENT_SECRET,
    APPLE_CLIENT_ID: source.APPLE_CLIENT_ID,
    APPLE_CLIENT_SECRET: source.APPLE_CLIENT_SECRET,
    AUTH_TRUSTED_PROXY_CIDRS:
      source.AUTH_TRUSTED_PROXY_CIDRS ??
      (canUseDevelopmentDefaults ? '127.0.0.1/32,::1/128' : undefined),
    CSP_MODE: source.CSP_MODE === '' ? undefined : source.CSP_MODE
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
