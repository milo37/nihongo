import { useTranslation } from 'react-i18next'
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactElement
} from 'react'
import {
  PauseIcon,
  PlayIcon,
  RestartIcon
} from '@app/practice/session/passageAudio/passageAudioIcons'
import type { PassageAudio } from '@app/practice/session/passageAudio/usePassageAudio'
import {
  AUDIO_KEY_STEP_MS,
  formatAudioTime
} from '@app/practice/session/passageAudio/passageAudioFormat'

/**
 * #1183: the play row under the passage head — play/pause circle, position
 * slider with the time beside it, speed chip, back-to-start chip.
 */
export const PassageAudioBar = ({
  audio,
  id,
  onSeekEnd
}: {
  audio: PassageAudio
  id: string
  /** After a drag or key move, so the passage can show the reading word. */
  onSeekEnd: () => void
}): ReactElement => {
  const { t } = useTranslation('practice')
  const { durationMs, timeMs } = audio
  const progress = durationMs > 0 ? Math.min(1, timeMs / durationMs) : 0

  const timeAt = (event: PointerEvent<HTMLDivElement>): number => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0
    return Math.round(Math.min(1, Math.max(0, ratio)) * durationMs)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = {
      ArrowRight: timeMs + AUDIO_KEY_STEP_MS,
      ArrowUp: timeMs + AUDIO_KEY_STEP_MS,
      ArrowLeft: timeMs - AUDIO_KEY_STEP_MS,
      ArrowDown: timeMs - AUDIO_KEY_STEP_MS,
      Home: 0,
      End: durationMs
    }[event.key]
    if (target === undefined) return
    event.preventDefault()
    audio.seek(target)
    onSeekEnd()
  }

  return (
    <div
      className="study-audio-row"
      data-playing={audio.isPlaying || undefined}
      id={id}
    >
      <button
        aria-label={t(
          audio.isPlaying
            ? 'session.question.audio.pause'
            : 'session.question.audio.play'
        )}
        className="study-audio-play"
        type="button"
        onClick={audio.togglePlay}
      >
        {audio.isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="study-audio-seek">
        <div
          aria-label={t('session.question.audio.position')}
          aria-valuemax={Math.floor(durationMs / 1000)}
          aria-valuemin={0}
          aria-valuenow={Math.floor(timeMs / 1000)}
          aria-valuetext={formatAudioTime(timeMs)}
          className="study-audio-track"
          data-dragging={audio.isDragging || undefined}
          role="slider"
          style={{ '--audio-progress': progress } as CSSProperties}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onLostPointerCapture={() => audio.preview(null)}
          onPointerDown={(event) => {
            if (event.button !== 0 || durationMs <= 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            audio.preview(timeAt(event))
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              audio.preview(timeAt(event))
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            audio.seek(timeAt(event))
            onSeekEnd()
          }}
        >
          <span aria-hidden="true" className="study-audio-fill" />
          <span aria-hidden="true" className="study-audio-thumb">
            {audio.isDragging ? (
              <span className="study-audio-tip">{formatAudioTime(timeMs)}</span>
            ) : null}
          </span>
        </div>
        <span aria-hidden="true" className="study-audio-time">
          {formatAudioTime(timeMs)} / {formatAudioTime(durationMs)}
        </span>
      </div>
      <button
        aria-label={t('session.question.audio.speed', { rate: audio.rate })}
        className="study-audio-chip"
        type="button"
        onClick={audio.cycleRate}
      >
        <span>{audio.rate}×</span>
      </button>
      <button
        aria-label={t('session.question.audio.restart')}
        className="study-audio-chip study-audio-restart"
        type="button"
        onClick={audio.restart}
      >
        <span>
          <RestartIcon />
        </span>
      </button>
    </div>
  )
}
