export type MonotonicNow = () => number

export class StudyQuestionClock {
  private readonly elapsedMilliseconds = new Map<string, number>()
  private activeQuestionId: string | null = null
  private activeStartedAt: number | null = null

  constructor(
    initialElapsedSeconds: Readonly<Record<string, number>>,
    private readonly now: MonotonicNow = () => performance.now()
  ) {
    for (const [questionId, seconds] of Object.entries(initialElapsedSeconds)) {
      this.elapsedMilliseconds.set(questionId, Math.max(0, seconds) * 1_000)
    }
  }

  resume(questionId: string): void {
    const observedAt = this.now()
    this.flushAt(observedAt)
    this.activeQuestionId = questionId
    this.activeStartedAt = observedAt
  }

  pause(): void {
    this.flushAt(this.now())
    this.activeQuestionId = null
    this.activeStartedAt = null
  }

  flush(): Readonly<Record<string, number>> {
    this.flushAt(this.now())
    return this.snapshot()
  }

  snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      [...this.elapsedMilliseconds.entries()].map(
        ([questionId, milliseconds]) => [
          questionId,
          Math.min(86_400, Math.floor(milliseconds / 1_000))
        ]
      )
    )
  }

  totalSeconds(): number {
    return Object.values(this.snapshot()).reduce(
      (total, seconds) => total + seconds,
      0
    )
  }

  rebase(
    initialElapsedSeconds: Readonly<Record<string, number>>,
    previousBaselineSeconds?: Readonly<Record<string, number>>
  ): this {
    this.flushAt(this.now())
    const previous = new Map(this.elapsedMilliseconds)
    this.elapsedMilliseconds.clear()

    for (const [questionId, seconds] of Object.entries(initialElapsedSeconds)) {
      const previousMilliseconds = previous.get(questionId) ?? 0
      const carry = previousBaselineSeconds
        ? Math.max(
            0,
            previousMilliseconds -
              (previousBaselineSeconds[questionId] ?? 0) * 1_000
          )
        : previousMilliseconds % 1_000
      this.elapsedMilliseconds.set(
        questionId,
        Math.min(86_400_000, Math.max(0, seconds) * 1_000 + carry)
      )
    }

    this.activeQuestionId = null
    this.activeStartedAt = null
    return this
  }

  private flushAt(observedAt: number): void {
    if (this.activeQuestionId === null || this.activeStartedAt === null) {
      return
    }

    const delta = Math.max(0, observedAt - this.activeStartedAt)
    const current = this.elapsedMilliseconds.get(this.activeQuestionId) ?? 0
    this.elapsedMilliseconds.set(
      this.activeQuestionId,
      Math.min(86_400_000, current + delta)
    )
    this.activeStartedAt = observedAt
  }
}
