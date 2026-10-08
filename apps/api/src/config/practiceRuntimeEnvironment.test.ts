import { describe, expect, it } from 'vitest'
import {
  parsePracticeRuntimeEnvironment,
  PracticeRuntimeEnvironmentError
} from './practiceRuntimeEnvironment.js'

describe('practice runtime environment', () => {
  it('development/test는 v1-v2를 기본값으로 사용하고 production은 명시를 요구한다', () => {
    expect(parsePracticeRuntimeEnvironment({}, 'test')).toEqual({
      runtime: 'v1-v2'
    })
    expect(() => parsePracticeRuntimeEnvironment({}, 'production')).toThrow(
      PracticeRuntimeEnvironmentError
    )
    expect(
      parsePracticeRuntimeEnvironment(
        { PRACTICE_CONTRACT_RUNTIME: 'v1-v2' },
        'production'
      )
    ).toEqual({ runtime: 'v1-v2' })
  })

  it('v1-compatible runtime은 외부 authority file을 요구한다', () => {
    expect(
      parsePracticeRuntimeEnvironment(
        {
          PRACTICE_CONTRACT_RUNTIME: 'v1-compatible',
          PRACTICE_COMPATIBILITY_AUTHORITY_FILE:
            '/run/nihongo/practice-compatibility-authority.json'
        },
        'production'
      )
    ).toEqual({
      runtime: 'v1-compatible',
      authorityFile: '/run/nihongo/practice-compatibility-authority.json'
    })

    expect(() =>
      parsePracticeRuntimeEnvironment(
        { PRACTICE_CONTRACT_RUNTIME: 'v1-compatible' },
        'production'
      )
    ).toThrow(PracticeRuntimeEnvironmentError)
  })
})
