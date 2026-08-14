import { describe, expect, it } from 'vitest'
import { EnvironmentValidationError, parseApiEnvironment } from './env.js'

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/nihongo_test',
  TRUSTED_ORIGINS: 'http://localhost:5173,https://example.com',
  BETTER_AUTH_SECRET: 'auth-secret-that-is-at-least-32-characters',
  GUEST_COOKIE_SECRET: 'guest-secret-that-is-at-least-32-characters',
  AUTH_EMAIL_FROM: 'auth@example.com'
}

describe('parseApiEnvironment', () => {
  it('알려진 환경 변수만 읽고 origin을 정규화한다', () => {
    expect(
      parseApiEnvironment({
        ...validEnvironment,
        UNRELATED_SECRET: 'ignored'
      })
    ).toMatchObject({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 3001,
      TRUSTED_ORIGINS: ['http://localhost:5173', 'https://example.com']
    })
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
