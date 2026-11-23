import type { ReactElement } from 'react'

/**
 * #986: the line above a passage the question shares with an earlier one.
 * The practice screen colors it; the result detail keeps it ink.
 */
export const SamePassageNote = ({
  text,
  tone
}: {
  text: string
  tone: 'practice' | 'result'
}): ReactElement => (
  <p className="study-same-passage" data-tone={tone}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M6.3 9.7l3.4-3.4" />
        <path d="M7.2 4.6l1.1-1.1a2.6 2.6 0 013.7 3.7l-1.1 1.1" />
        <path d="M8.8 11.4l-1.1 1.1a2.6 2.6 0 01-3.7-3.7l1.1-1.1" />
      </g>
    </svg>
    {text}
  </p>
)
