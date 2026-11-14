// #997: today's question writes itself in once per page load. Moving back
// to home inside the app keeps it still; a reload or a new window plays it
// again. Nothing is stored.
let played = false

/** Write-in timing (design #997, the manuscript-pen tone). */
export const WRITE_IN_CHAR_MS = 180
const WRITE_IN_MAX_STEP_MS = 45
const WRITE_IN_SPREAD_MS = 820

/** Gap between squares: any length finishes within a second. */
export const writeInStepMs = (characterCount: number): number =>
  characterCount > 1
    ? Math.min(WRITE_IN_MAX_STEP_MS, WRITE_IN_SPREAD_MS / (characterCount - 1))
    : WRITE_IN_MAX_STEP_MS

export const dailyWriteIn = {
  hasPlayed(): boolean {
    return played
  },
  markPlayed(): void {
    played = true
  },
  resetForTesting(): void {
    played = false
  }
}
