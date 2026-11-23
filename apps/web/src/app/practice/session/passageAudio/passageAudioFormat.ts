// #1183: the play row's time label and key step.

/** 0:12 — minutes and two-digit seconds, rounded down. */
export const formatAudioTime = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Arrow keys on the position slider move this far. */
export const AUDIO_KEY_STEP_MS = 5000
