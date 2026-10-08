import { describe, expect, it } from 'vitest'
import {
  createClientIpAuthority,
  INTERNAL_CLIENT_IP_HEADER
} from './clientIp.js'

describe('client IP authority', () => {
  it('untrusted peer의 forwarded header와 외부 internal header를 무시한다', () => {
    const authority = createClientIpAuthority(['10.0.0.0/8'])
    const request = authority.apply(
      new Request('http://localhost', {
        headers: {
          'X-Forwarded-For': '198.51.100.7',
          [INTERNAL_CLIENT_IP_HEADER]: '203.0.113.9'
        }
      }),
      '192.0.2.10'
    )

    expect(request.headers.get(INTERNAL_CLIENT_IP_HEADER)).toBe('192.0.2.10')
  })

  it('trusted proxy chain을 right-to-left로 검증한다', () => {
    const authority = createClientIpAuthority(['10.0.0.0/8'])

    expect(authority.resolve('10.0.0.2', '198.51.100.7, 10.0.0.3')).toBe(
      '198.51.100.7'
    )
    expect(authority.resolve('10.0.0.2', '10.0.0.3')).toBe('10.0.0.2')
    expect(authority.resolve('10.0.0.2', 'invalid')).toBe('10.0.0.2')
    expect(authority.resolve('::ffff:192.0.2.10', null)).toBe('192.0.2.10')
  })
})
