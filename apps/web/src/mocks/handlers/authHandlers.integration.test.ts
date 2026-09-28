import { describe, expect, it } from 'vitest'
import { cachedStorage, MOCK_DATABASE_STORAGE_KEY } from '@libs/storage'

describe('mock authoritative current principal', () => {
  it('fails closed with no-store when canonical auth storage is corrupt', async () => {
    cachedStorage.setItem(MOCK_DATABASE_STORAGE_KEY, '{')

    const response = await fetch(`${globalThis.location.origin}/api/v1/me`)

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: '최신 인증 세션을 확인하지 못했습니다.'
    })
  })
})
