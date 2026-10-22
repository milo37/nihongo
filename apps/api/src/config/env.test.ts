import { describe, expect, it } from 'vitest'
import { EnvironmentValidationError, parseApiEnvironment } from './env.js'

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://nihongo_test_legacy_app_login:password@localhost:5432/nihongo_test',
  TRUSTED_ORIGINS: 'http://localhost:5173,https://example.com',
  BETTER_AUTH_SECRET: 'auth-secret-that-is-at-least-32-characters',
  GUEST_COOKIE_SECRET: 'guest-secret-that-is-at-least-32-characters',
  AUTH_EMAIL_FROM: 'auth@example.com'
}

const technicalDatabaseUrl =
  'postgresql://nihongo_test_auth_gateway_login:password@localhost:5432/nihongo_test?schema=phase7_test'

describe('parseApiEnvironment', () => {
  it('알려진 환경 변수만 읽고 origin을 정규화한다', () => {
    expect(
      parseApiEnvironment({
        ...validEnvironment,
        UNRELATED_SECRET: 'ignored'
      })
    ).toMatchObject({
      NODE_ENV: 'test',
      DEPLOYMENT_ENVIRONMENT: 'TEST',
      ADMIN_CMS_MODE: 'disabled',
      HOST: '127.0.0.1',
      PORT: 3001,
      TRUSTED_ORIGINS: ['http://localhost:5173', 'https://example.com']
    })
  })

  it('technical admin CMS mode는 test/development에서만 허용한다', () => {
    expect(
      parseApiEnvironment({
        ...validEnvironment,
        ADMIN_CMS_MODE: 'technical',
        DATABASE_URL:
          'postgresql://nihongo_test_app_login:password@localhost:5432/nihongo_test?schema=phase7_test',
        AUTH_GATEWAY_DATABASE_URL: technicalDatabaseUrl
      }).ADMIN_CMS_MODE
    ).toBe('technical')

    expect(() =>
      parseApiEnvironment({
        ...validEnvironment,
        ADMIN_CMS_MODE: 'technical'
      })
    ).toThrow(EnvironmentValidationError)

    expect(() =>
      parseApiEnvironment({
        ...validEnvironment,
        ADMIN_CMS_MODE: 'technical',
        AUTH_GATEWAY_DATABASE_URL: technicalDatabaseUrl
      })
    ).toThrow(EnvironmentValidationError)

    expect(() =>
      parseApiEnvironment({
        ...validEnvironment,
        ADMIN_CMS_MODE: 'enabled'
      })
    ).toThrow(EnvironmentValidationError)
  })

  it('disabled DB login 권한 검사는 server startup guard에 위임한다', () => {
    expect(
      parseApiEnvironment({
        ...validEnvironment,
        DATABASE_URL:
          'postgresql://isolated_test_owner:password@localhost:5432/nihongo_test'
      }).ADMIN_CMS_MODE
    ).toBe('disabled')
  })

  it.each([
    [
      'application schema 누락',
      'postgresql://nihongo_test_app_login:password@localhost:5432/nihongo_test',
      technicalDatabaseUrl
    ],
    [
      'auth gateway schema 누락',
      'postgresql://nihongo_test_app_login:password@localhost:5432/nihongo_test?schema=phase7_test',
      'postgresql://nihongo_test_auth_gateway_login:password@localhost:5432/nihongo_test'
    ],
    [
      'schema 중복',
      'postgresql://nihongo_test_app_login:password@localhost:5432/nihongo_test?schema=phase7_test&schema=public',
      technicalDatabaseUrl
    ],
    [
      'unsafe schema',
      'postgresql://nihongo_test_app_login:password@localhost:5432/nihongo_test?schema=Phase7-Test',
      technicalDatabaseUrl
    ],
    [
      'startup options override',
      'postgresql://nihongo_test_app_login:password@localhost:5432/nihongo_test?schema=phase7_test&options=-c%20TimeZone%3DAsia%2FTokyo',
      technicalDatabaseUrl
    ]
  ])('technical mode에서 %s을 거부한다', (_label, databaseUrl, authUrl) => {
    expect(() =>
      parseApiEnvironment({
        ...validEnvironment,
        ADMIN_CMS_MODE: 'technical',
        DATABASE_URL: databaseUrl,
        AUTH_GATEWAY_DATABASE_URL: authUrl
      })
    ).toThrow(EnvironmentValidationError)
  })

  it.each([
    [
      'application wrapper mismatch',
      'postgresql://nihongo_test_auth_gateway_login:password@localhost:5432/nihongo_test?schema=phase7_test',
      technicalDatabaseUrl
    ],
    [
      'auth gateway wrapper mismatch',
      'postgresql://nihongo_test_app_login:password@localhost:5432/nihongo_test?schema=phase7_test',
      'postgresql://nihongo_test_app_login:password@localhost:5432/nihongo_test?schema=phase7_test'
    ]
  ])('technical mode에서 %s를 거부한다', (_label, databaseUrl, authUrl) => {
    expect(() =>
      parseApiEnvironment({
        ...validEnvironment,
        ADMIN_CMS_MODE: 'technical',
        DATABASE_URL: databaseUrl,
        AUTH_GATEWAY_DATABASE_URL: authUrl
      })
    ).toThrow(EnvironmentValidationError)
  })

  it('오류에 secret 값을 포함하지 않고 필드명만 노출한다', () => {
    const secret = 'do-not-print-this-secret'

    expect(() =>
      parseApiEnvironment({
        ...validEnvironment,
        DATABASE_URL: secret
      })
    ).toThrow(EnvironmentValidationError)

    try {
      parseApiEnvironment({ ...validEnvironment, DATABASE_URL: secret })
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentValidationError)
      expect(String(error)).not.toContain(secret)
      expect(String(error)).toContain('DATABASE_URL')
    }
  })

  it('NODE_ENV를 명시하지 않으면 실패한다', () => {
    expect(() =>
      parseApiEnvironment({
        DATABASE_URL: validEnvironment.DATABASE_URL,
        TRUSTED_ORIGINS: validEnvironment.TRUSTED_ORIGINS
      })
    ).toThrow(EnvironmentValidationError)
  })

  it.each([
    'file:///tmp',
    'ftp://example.com',
    'https://*.example.com',
    'https://user:password@example.com',
    'https://example.com/path'
  ])('exact http(s) origin이 아닌 %s를 거부한다', (origin) => {
    expect(() =>
      parseApiEnvironment({ ...validEnvironment, TRUSTED_ORIGINS: origin })
    ).toThrow(EnvironmentValidationError)
  })

  it('production에서 명시적 항목·DB TLS·HTTPS origin을 요구한다', () => {
    const productionEnvironment = {
      NODE_ENV: 'production',
      DEPLOYMENT_ENVIRONMENT: 'PRODUCTION',
      RELEASE_ID: '1234567890abcdef1234567890abcdef12345678',
      HOST: '0.0.0.0',
      PORT: '3001',
      DATABASE_URL:
        'postgresql://user:password@database:5432/nihongo?sslmode=verify-full',
      TRUSTED_ORIGINS: 'https://nihongo.example.com',
      LOG_LEVEL: 'info',
      BETTER_AUTH_SECRET: 'production-auth-secret-at-least-32-characters',
      BETTER_AUTH_URL: 'https://nihongo.example.com',
      GUEST_COOKIE_SECRET: 'production-guest-secret-at-least-32-characters',
      AUTH_EMAIL_FROM: 'auth@nihongo.example.com',
      AUTH_EMAIL_DELIVERY_MODE: 'webhook',
      AUTH_EMAIL_WEBHOOK_URL: 'https://mail.example.com/auth-events',
      AUTH_EMAIL_WEBHOOK_SECRET:
        'production-email-secret-at-least-32-characters',
      AUTH_TRUSTED_PROXY_CIDRS: '10.0.0.0/8'
    }

    expect(parseApiEnvironment(productionEnvironment)).toMatchObject({
      NODE_ENV: 'production',
      DEPLOYMENT_ENVIRONMENT: 'PRODUCTION',
      ADMIN_CMS_MODE: 'disabled',
      TRUSTED_ORIGINS: ['https://nihongo.example.com']
    })
    expect(() =>
      parseApiEnvironment({
        ...productionEnvironment,
        DATABASE_URL: 'postgresql://user:password@database:5432/nihongo'
      })
    ).toThrow(EnvironmentValidationError)
    expect(() =>
      parseApiEnvironment({
        ...productionEnvironment,
        DATABASE_URL:
          'postgresql://user:password@database:5432/nihongo?sslmode=require&sslmode=disable'
      })
    ).toThrow(EnvironmentValidationError)
    expect(() =>
      parseApiEnvironment({
        ...productionEnvironment,
        TRUSTED_ORIGINS: 'http://nihongo.example.com'
      })
    ).toThrow(EnvironmentValidationError)
    expect(() =>
      parseApiEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: productionEnvironment.DATABASE_URL
      })
    ).toThrow(EnvironmentValidationError)
    expect(() =>
      parseApiEnvironment({
        ...productionEnvironment,
        RELEASE_ID: undefined
      })
    ).toThrow(EnvironmentValidationError)
    expect(() =>
      parseApiEnvironment({
        ...productionEnvironment,
        RELEASE_ID: 'not-a-git-commit'
      })
    ).toThrow(EnvironmentValidationError)
    expect(() =>
      parseApiEnvironment({
        ...productionEnvironment,
        RELEASE_ID: '0000000000000000000000000000000000000000'
      })
    ).toThrow(EnvironmentValidationError)
    expect(() =>
      parseApiEnvironment({
        ...productionEnvironment,
        TRUSTED_ORIGINS: 'https://nihongo.example.com,https://extra.example.com'
      })
    ).toThrow(EnvironmentValidationError)
    expect(() =>
      parseApiEnvironment({
        ...productionEnvironment,
        DEPLOYMENT_ENVIRONMENT: 'LOCAL'
      })
    ).toThrow(EnvironmentValidationError)
    expect(() =>
      parseApiEnvironment({
        ...productionEnvironment,
        ADMIN_CMS_MODE: 'technical'
      })
    ).toThrow(EnvironmentValidationError)
  })

  it('auth와 guest secret 재사용을 거부한다', () => {
    expect(() =>
      parseApiEnvironment({
        ...validEnvironment,
        GUEST_COOKIE_SECRET: validEnvironment.BETTER_AUTH_SECRET
      })
    ).toThrow(EnvironmentValidationError)
  })

  it.each(['not-an-ip', '10.0.0.0/33', '::1/129', '10.0.0.0/8/extra'])(
    '유효하지 않은 trusted proxy %s를 거부한다',
    (value) => {
      expect(() =>
        parseApiEnvironment({
          ...validEnvironment,
          AUTH_TRUSTED_PROXY_CIDRS: value
        })
      ).toThrow(EnvironmentValidationError)
    }
  )
})
