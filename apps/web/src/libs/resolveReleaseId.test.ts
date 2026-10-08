import { describe, expect, it } from 'vitest'
import { LOCAL_RELEASE_ID, resolveReleaseId } from '@libs/resolveReleaseId'

describe('resolveReleaseId', () => {
  it('설정이 없으면 로컬 식별자를 사용한다', () => {
    expect(resolveReleaseId(undefined)).toBe(LOCAL_RELEASE_ID)
    expect(resolveReleaseId('')).toBe(LOCAL_RELEASE_ID)
  })

  it('lowercase full Git SHA만 허용한다', () => {
    const releaseId = '1234567890abcdef1234567890abcdef12345678'

    expect(resolveReleaseId(releaseId)).toBe(releaseId)
    expect(() => resolveReleaseId('1234567')).toThrow(
      'VITE_RELEASE_ID must be a lowercase 40-character Git SHA.'
    )
    expect(() => resolveReleaseId(releaseId.toUpperCase())).toThrow(
      'VITE_RELEASE_ID must be a lowercase 40-character Git SHA.'
    )
  })

  it('release build는 nonzero Git SHA를 요구한다', () => {
    expect(() =>
      resolveReleaseId(undefined, { requireDeployable: true })
    ).toThrow('VITE_RELEASE_ID is required for a release build.')
    expect(() =>
      resolveReleaseId(LOCAL_RELEASE_ID, { requireDeployable: true })
    ).toThrow('The local release sentinel cannot identify a release build.')
    expect(
      resolveReleaseId('1234567890abcdef1234567890abcdef12345678', {
        requireDeployable: true
      })
    ).toBe('1234567890abcdef1234567890abcdef12345678')
  })
})
