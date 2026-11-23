import type { ReactElement } from 'react'

// #1183 play row icons; PlayIcon is also the ▶ in the [듣기] pill.
export const PlayIcon = (): ReactElement => (
  <svg aria-hidden="true" className="study-audio-icon" viewBox="0 0 16 16">
    <path d="M4 2.5v11l9.5-5.5z" fill="currentColor" />
  </svg>
)

export const PauseIcon = (): ReactElement => (
  <svg aria-hidden="true" className="study-audio-icon" viewBox="0 0 16 16">
    <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor" />
  </svg>
)

export const RestartIcon = (): ReactElement => (
  <svg aria-hidden="true" className="study-audio-icon" viewBox="0 0 16 16">
    <path
      d="M3.2 8.6A5 5 0 1 0 4.6 4.5M3.5 1.8v3.1h3.1"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
  </svg>
)
