import { useState } from 'react'

type PushState = {
  readonly index: number
  readonly isShown: boolean
  readonly from: number | null
  readonly key: number
}

export type QuestionPushMove = {
  /** The question sliding out, or null when nothing moves. */
  readonly from: number | null
  readonly direction: 'next' | 'prev' | undefined
  /** Changes on every move so both cards restart their slide. */
  readonly key: number
  readonly finish: () => void
}

const canMove = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches ===
    true

/**
 * JLP-870: when the question changes, the old one is pushed out while the
 * new one comes in (next: to the left, previous: to the right; a sheet jump
 * compares the numbers). Nothing moves until a question has been shown
 * (first entry, resume, reload) or with reduced motion. A move during a slide starts from the question now shown, so the
 * running slide just ends; input is never held.
 */
export const useQuestionPush = (
  index: number,
  isShown: boolean
): QuestionPushMove => {
  const [state, setState] = useState<PushState>({
    index,
    isShown,
    from: null,
    key: 0
  })
  let shown = state
  if (state.index !== index || state.isShown !== isShown) {
    shown = {
      index,
      isShown,
      from:
        state.index !== index && state.isShown && isShown && canMove()
          ? state.index
          : null,
      key: state.index !== index ? state.key + 1 : state.key
    }
    setState(shown)
  }
  const { from, key } = shown
  return {
    from,
    direction: from === null ? undefined : index > from ? 'next' : 'prev',
    key,
    finish: () =>
      setState((current) =>
        current.key === key ? { ...current, from: null } : current
      )
  }
}
