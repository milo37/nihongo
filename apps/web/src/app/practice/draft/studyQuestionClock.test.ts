import { describe, expect, it } from 'vitest'
import { StudyQuestionClock } from '@app/practice/draft/studyQuestionClock'

describe('StudyQuestionClock', () => {
  it('counts only the active foreground question with a monotonic source', () => {
    let now = 100
    const clock = new StudyQuestionClock({ first: 2, second: 0 }, () => now)

    clock.resume('first')
    now += 1_900
    clock.pause()
    now += 60_000
    clock.resume('second')
    now += 2_100
    clock.pause()

    expect(clock.snapshot()).toEqual({ first: 3, second: 2 })
    expect(clock.totalSeconds()).toBe(5)
  })

  it('flushes rapid navigation exactly once and retains sub-second carry', () => {
    let now = 0
    const clock = new StudyQuestionClock({}, () => now)

    clock.resume('first')
    now = 750
    clock.resume('second')
    now = 1_500
    clock.resume('first')
    now = 1_750
    clock.pause()

    expect(clock.snapshot()).toEqual({ first: 1, second: 0 })
  })

  it('ignores a backwards monotonic observation', () => {
    let now = 10_000
    const clock = new StudyQuestionClock({ first: 4 }, () => now)
    clock.resume('first')
    now = 9_000
    clock.pause()

    expect(clock.snapshot()).toEqual({ first: 4 })
  })

  it('caps each question at one day across a reload-style initial value', () => {
    let now = 0
    const clock = new StudyQuestionClock({ first: 86_399 }, () => now)
    clock.resume('first')
    now = 10_000
    clock.pause()

    expect(clock.snapshot()).toEqual({ first: 86_400 })
  })

  it('preserves sub-second carry while rebasing confirmed integer seconds', () => {
    let now = 0
    const clock = new StudyQuestionClock({ first: 0 }, () => now)
    clock.resume('first')
    now = 800

    clock.rebase({ first: 0 })
    clock.resume('first')
    now = 1_100
    clock.pause()

    expect(clock.snapshot()).toEqual({ first: 1 })
  })

  it('carries only time accrued after the last persisted baseline', () => {
    let now = 0
    const clock = new StudyQuestionClock({ first: 2 }, () => now)
    clock.resume('first')
    now = 1_500

    clock.rebase({ first: 2 }, { first: 2 })

    expect(clock.snapshot()).toEqual({ first: 3 })
  })
})
