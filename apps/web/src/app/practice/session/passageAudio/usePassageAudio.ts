import { useEffect, useRef, useState } from 'react'
import type {
  PassageAudioMark,
  PassageAudioMarks,
  PassageAudioRef
} from '@nihongo/contracts/question/passage-audio'
import {
  fetchPassageAudioMarks,
  passageAudioUrl
} from '@app/practice/session/passageAudio/passageAudioSource'
import {
  nextAudioRate,
  wordAt,
  type AudioRate
} from '@app/practice/session/passageAudio/passageAudioTime'

// The shown time moves in these steps; the reading word follows the same
// clock, so a 0.2s word is still caught.
const TICK_MS = 50

export type PassageAudio = {
  readonly isOpen: boolean
  readonly isPlaying: boolean
  /** The audio could not be played; the [듣기] button goes away. */
  readonly isFailed: boolean
  readonly isDragging: boolean
  /** The position shown: the dragged spot while dragging. */
  readonly timeMs: number
  readonly durationMs: number
  readonly rate: AudioRate
  /** The word being read, while the bar is open. */
  readonly word: PassageAudioMark | null
  readonly open: () => void
  readonly close: () => void
  readonly togglePlay: () => void
  readonly restart: () => void
  readonly cycleRate: () => void
  readonly seek: (ms: number) => void
  /** Show a spot while dragging (null ends the drag without moving). */
  readonly preview: (ms: number | null) => void
}

/**
 * #1183: one passage's read-aloud. The audio element is made on the first
 * [듣기] press (inside the tap, so phones let it play) and dropped when the
 * passage changes. Closing pauses and clears the reading word; opening again
 * goes on from the same spot.
 */
export const usePassageAudio = (
  passageAudio: PassageAudioRef | null
): PassageAudio => {
  const audioKey = passageAudio?.key ?? null
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const marksAbortRef = useRef<AbortController | null>(null)
  // A play waiting for a jump back to finish; calling it drops the wait.
  const pendingPlayRef = useRef<(() => void) | null>(null)
  const [isOpen, setOpen] = useState(false)
  const [isPlaying, setPlaying] = useState(false)
  const [isFailed, setFailed] = useState(false)
  const [rate, setRate] = useState<AudioRate>(1)
  const [timeMs, setTimeMs] = useState(0)
  const [dragMs, setDragMs] = useState<number | null>(null)
  const [mediaDurationMs, setMediaDurationMs] = useState(0)
  const [marks, setMarks] = useState<PassageAudioMarks | null>(null)

  // A new passage starts closed, at the start, with nothing loaded.
  useEffect(
    () => () => {
      pendingPlayRef.current?.()
      marksAbortRef.current?.abort()
      marksAbortRef.current = null
      const audio = audioRef.current
      audioRef.current = null
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      setOpen(false)
      setPlaying(false)
      setFailed(false)
      setTimeMs(0)
      setDragMs(null)
      setMediaDurationMs(0)
      setMarks(null)
    },
    [audioKey]
  )

  useEffect(() => {
    const audio = audioRef.current
    if (!isPlaying || !audio) return
    let frame = 0
    const tick = (): void => {
      setTimeMs(Math.round((audio.currentTime * 1000) / TICK_MS) * TICK_MS)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying])

  // The question already says how long it is, so the total shows before the
  // timings or the file arrive.
  const durationMs =
    marks?.durationMs || mediaDurationMs || passageAudio?.durationMs || 0

  const load = (key: string): HTMLAudioElement => {
    const audio = new Audio(passageAudioUrl(key))
    audio.preload = 'auto'
    audio.playbackRate = rate
    audio.addEventListener('play', () => setPlaying(true))
    audio.addEventListener('pause', () => setPlaying(false))
    audio.addEventListener('ended', () => {
      setPlaying(false)
      setTimeMs(Math.round(audio.currentTime * 1000))
    })
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration))
        setMediaDurationMs(Math.round(audio.duration * 1000))
    })
    audio.addEventListener('error', () => {
      if (audioRef.current !== audio) return
      setFailed(true)
      setOpen(false)
      setPlaying(false)
    })
    const controller = new AbortController()
    marksAbortRef.current = controller
    // Without timings it still plays; only the reading word is missing.
    fetchPassageAudioMarks(key, controller.signal).then(
      (loaded) => {
        if (!controller.signal.aborted) setMarks(loaded)
      },
      () => undefined
    )
    audioRef.current = audio
    return audio
  }

  const cancelPendingPlay = (): void => {
    pendingPlayRef.current?.()
    pendingPlayRef.current = null
  }

  const start = (audio: HTMLAudioElement): void => {
    // A refused play (autoplay rules) leaves it paused; the button still works.
    void audio.play()?.catch(() => undefined)
  }

  // WebKit can play from the old spot when play() follows a currentTime
  // change at once, so a jump back plays only after `seeked`.
  const playFrom = (audio: HTMLAudioElement, seconds: number): void => {
    cancelPendingPlay()
    const onSeeked = (): void => {
      pendingPlayRef.current = null
      start(audio)
    }
    audio.addEventListener('seeked', onSeeked, { once: true })
    pendingPlayRef.current = () => audio.removeEventListener('seeked', onSeeked)
    audio.currentTime = seconds
  }

  const play = (audio: HTMLAudioElement): void => {
    if (audio.ended) playFrom(audio, 0)
    else start(audio)
  }

  const seek = (ms: number): void => {
    const end = durationMs || ms
    const next = Math.min(Math.max(0, ms), end)
    cancelPendingPlay()
    setDragMs(null)
    setTimeMs(next)
    const audio = audioRef.current
    if (audio) audio.currentTime = next / 1000
  }

  const shownMs = dragMs ?? timeMs

  return {
    isOpen,
    isPlaying,
    isFailed,
    isDragging: dragMs !== null,
    timeMs: shownMs,
    durationMs,
    rate,
    word: isOpen && marks ? wordAt(marks.words, shownMs) : null,
    open: () => {
      if (!audioKey) return
      setOpen(true)
      play(audioRef.current ?? load(audioKey))
    },
    close: () => {
      cancelPendingPlay()
      audioRef.current?.pause()
      setDragMs(null)
      setOpen(false)
    },
    togglePlay: () => {
      const audio = audioRef.current
      if (!audio) return
      if (audio.paused) play(audio)
      else {
        cancelPendingPlay()
        audio.pause()
      }
    },
    restart: () => {
      const audio = audioRef.current
      if (!audio?.paused) {
        seek(0)
        return
      }
      setDragMs(null)
      setTimeMs(0)
      playFrom(audio, 0)
    },
    cycleRate: () => {
      const next = nextAudioRate(rate)
      setRate(next)
      if (audioRef.current) audioRef.current.playbackRate = next
    },
    seek,
    preview: setDragMs
  }
}
