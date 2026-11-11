import { describe, expect, it } from 'vitest'
import {
  FAILURE_SUMMARY_MAX_LENGTH,
  summarizeFailureMessage
} from './failureSummary.js'

const environment = {
  DATABASE_URL:
    'postgresql://nihongo:ci_only_password@127.0.0.1:5432/nihongo_test?schema=s1',
  BETTER_AUTH_SECRET: 'fake-auth-value-1234567890',
  GUEST_COOKIE_SECRET: 'cookie-secret-abcdef',
  NODE_ENV: 'test'
}
const summarize = (message: string) =>
  summarizeFailureMessage(message, environment)

describe('masked failure summary (CCD-664)', () => {
  it('keeps the first non-empty line of an assertion', () => {
    expect(
      summarize(
        '\n\u001b[31mAssertionError: expected 1 to be 0\u001b[39m\n    at stack (file.ts:1:1)\n- Expected\n+ Received'
      )
    ).toBe('AssertionError: expected 1 to be 0')
  })

  it('keeps UUIDs, counts and test words readable', () => {
    const line =
      "AssertionError: expected [ '0468c832-f5de-42b5-82be-6a9a511a3098' ] to deeply equal []"
    expect(summarize(line)).toBe(line)
  })

  it.each([
    [
      'expected DATABASE_URL postgresql://nihongo:ci_only_password@127.0.0.1:5432/nihongo_test?schema=s1',
      'ci_only_password'
    ],
    ['connect failed: postgres://user:pw@db.internal:5432/x', 'pw@db'],
    ['secret leaked fake-auth-value-1234567890 here', 'fake-auth-value'],
    ['cookie-secret-abcdef was echoed', 'cookie-secret-abcdef'],
    ['header Authorization: Bearer abc.def.ghi', 'abc.def.ghi'],
    ['token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig in body', 'eyJhbGci'],
    ['user someone@example.com not found', 'someone@example.com'],
    ['digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b', '9f86d081884c7d65'],
    ['raw VGhpcyBpcyBhIHNlY3JldCB2YWx1ZTEyMw== seen', 'VGhpcyBpcyBhIHNl'],
    ['set API_KEY=shhh-value and retried', 'shhh-value'],
    ['body {"password":"hunter2-pass"} rejected', 'hunter2-pass'],
    ['tokenDigest: abcdefabcdef was stale', 'abcdefabcdef'],
    ['echo fake-auth\u200b-value-1234567890 split', 'value-1234567890'],
    ['echo fake\u2060-auth-value-1234567890 joined', 'auth-value'],
    ['query q=fake%2Dauth%2Dvalue%2D1234567890 sent', '1234567890'],
    ['query q=fake%252Dauth%252Dvalue%252D1234567890 sent', '1234567890'],
    ['dsn nihongo:ci_only_password@127.0.0.1:5432 refused', 'ci_only'],
    ['dsn user:pw@db.internal refused', 'pw@db'],
    ['config apiKey=Ab1Cd2Ef3Gh4 rejected', 'Ab1Cd2Ef3Gh4'],
    ['config privateKey: abcdefgh rejected', 'abcdefgh'],
    ['config credential=plainvalue rejected', 'plainvalue'],
    ['password: "correct horse battery staple"', 'battery staple']
  ])('masks %s', (message, secret) => {
    const summary = summarize(message)
    expect(summary).not.toContain(secret)
    expect(summary).toMatch(
      /<(?:url|env|credential|secret|token|email|hex|base64)>/u
    )
  })

  it('never prints an environment value, even inside other text', () => {
    for (const value of Object.values(environment).filter(
      (value) => value.length >= 6
    ))
      expect(summarize(`before${value}after`)).not.toContain(value)
  })

  it(`cuts to ${FAILURE_SUMMARY_MAX_LENGTH} characters`, () => {
    const summary = summarize(`expected ${'가'.repeat(500)}`)
    expect(summary).toHaveLength(FAILURE_SUMMARY_MAX_LENGTH)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('says when there is no failure text', () => {
    expect(summarizeFailureMessage(undefined, environment)).toBe(
      'no failure message'
    )
    expect(summarize('\n  \n')).toBe('no failure message')
  })
})
