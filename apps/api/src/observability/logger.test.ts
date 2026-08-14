import { describe, expect, it } from 'vitest'
import { createJsonLogger, sanitizeLogContext } from './logger.js'

describe('structured logger', () => {
  it('인증·개인·문항·DB 민감 필드를 중첩 구조에서 redaction한다', () => {
    expect(
      sanitizeLogContext({
        authorization: 'Bearer credential',
        connectionString: 'postgresql://credential',
        correctOptionId: 'option-1',
        email: 'learner@example.com',
        memo: '개인 학습 메모',
        nested: {
          answerText: '정답 원문',
          password: 'credential',
          pii: { name: '학습자' },
          query: 'SELECT secret FROM users',
          safe: 'visible'
        },
        databaseUrl: 'postgresql://credential'
      })
    ).toEqual({
      authorization: '[REDACTED]',
      connectionString: '[REDACTED]',
      correctOptionId: '[REDACTED]',
      email: '[REDACTED]',
      memo: '[REDACTED]',
      nested: {
        answerText: '[REDACTED]',
        password: '[REDACTED]',
        pii: '[REDACTED]',
        query: '[REDACTED]',
        safe: 'visible'
      },
      databaseUrl: '[REDACTED]'
    })
  })

  it('설정한 level 이상의 JSON 로그만 기록한다', () => {
    const lines: string[] = []
    const logger = createJsonLogger('warn', (line) => lines.push(line))

    logger.info('ignored')
    logger.error('request.failed', { requestId: 'request-id' })

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'error',
      event: 'request.failed',
      requestId: 'request-id'
    })
  })
})
