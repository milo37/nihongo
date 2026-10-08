import { describe, expect, it } from 'vitest'
import { createPhase7ReauthenticationContext } from './phase7ReauthenticationContext.js'

describe('Phase 7 reauthentication invocation context', () => {
  it('교차 요청이 await 경계에서 각 intent를 유지한다', async () => {
    const context = createPhase7ReauthenticationContext()
    let releaseFirst: (() => void) | undefined
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = context.run('intent-a', async () => {
      expect(context.getIntentId()).toBe('intent-a')
      await firstBlocked
      expect(context.getIntentId()).toBe('intent-a')
      return context.getIntentId()
    })
    const second = context.run('intent-b', async () => {
      await Promise.resolve()
      expect(context.getIntentId()).toBe('intent-b')
      releaseFirst?.()
      return context.getIntentId()
    })

    await expect(Promise.all([first, second])).resolves.toEqual([
      'intent-a',
      'intent-b'
    ])
    expect(() => context.getIntentId()).toThrow(
      'Reauthentication adapter context is unavailable.'
    )
  })

  it('같은 async chain의 nested intent 교체를 거부한다', async () => {
    const context = createPhase7ReauthenticationContext()

    await expect(
      context.run(
        'outer',
        async () =>
          await context.run('inner', async () => context.getIntentId())
      )
    ).rejects.toThrow('Nested reauthentication adapter context is denied.')
  })
})
