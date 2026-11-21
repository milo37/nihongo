import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { cachedStorage } from '@nihongo/browser/libs/storage'
import { pickOmikuji, seoulToday } from '@app/account/omikuji/pickOmikuji'

// Design fe-spec 4 (1.5x, operator 11/20), from the press: the button dips
// for 160ms, the sheet opens at 170ms and rises for 380ms, Maru shakes for
// 800ms, holds the box low for 650ms, then the slip. Closing takes 280ms.
const OPEN_AT = 170
const LOWER_AT = 1365
const RESULT_AT = 2015
const CLOSE_MS = 280
// A phone sheet dragged down this far closes.
const DRAG_CLOSE_PX = 80
const DRAG_START_PX = 6

export type OmikujiPhase = 'shake' | 'lower' | 'result'

const drawnKey = (userId: string, date: string) =>
  `harumaru:omikuji:${userId}:${date}`

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * #1055 one member's slip for today and the sheet that shows it. Only the
 * day's first draw plays; after that (this device remembers, K-2) the sheet
 * opens on the slip with a note. Nothing closes it while it plays.
 */
export const useOmikuji = (userId: string) => {
  const [date, setDate] = useState(seoulToday)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [phase, setPhase] = useState<OmikujiPhase>('result')
  const [again, setAgain] = useState(false)
  const [played, setPlayed] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [announce, setAnnounce] = useState(false)
  const [drawn, setDrawn] = useState(
    () => cachedStorage.getItem(drawnKey(userId, date)) !== null
  )
  const dialogRef = useRef<HTMLDialogElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const timers = useRef<number[]>([])
  const drag = useRef<{ y: number; dy: number } | null>(null)
  const pick = pickOmikuji(userId, date)

  const clearTimers = () => {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
  }
  useEffect(() => clearTimers, [])

  // The sheet's content mounts with `open`; then the window opens on it and
  // its title takes focus.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    if (dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    titleRef.current?.focus()
  }, [open])

  const finish = () => {
    clearTimers()
    setOpen(false)
    setClosing(false)
    const dialog = dialogRef.current
    if (typeof dialog?.close === 'function') dialog.close()
    else dialog?.removeAttribute('open')
    buttonRef.current?.focus()
  }

  // A second Esc in a row closes a modal without a cancel event, even while
  // it plays: then the sheet simply ends there (the day still counts).
  const onDialogClose = () => {
    if (!open) return
    clearTimers()
    setOpen(false)
    setClosing(false)
    buttonRef.current?.focus()
  }

  // Fill the live region a moment after the slip shows, so screen readers
  // hear it even when the sheet opens straight on the slip.
  useEffect(() => {
    if (!open || phase !== 'result') return
    const timer = window.setTimeout(() => setAnnounce(true), 150)
    return () => window.clearTimeout(timer)
  }, [open, phase])

  const start = () => {
    if (open || pressed) return
    const today = seoulToday()
    const key = drawnKey(userId, today)
    const seen = cachedStorage.getItem(key) !== null
    const still = reducedMotion()
    const play = !seen && !still
    const show = () => {
      setPressed(false)
      setAnnounce(false)
      setDate(today)
      setAgain(seen)
      setPlayed(play)
      setPhase(play ? 'shake' : 'result')
      setClosing(false)
      setOpen(true)
      cachedStorage.setItem(key, '1')
      setDrawn(true)
    }
    if (still) {
      show()
      return
    }
    setPressed(true)
    timers.current = [window.setTimeout(show, OPEN_AT)]
    if (play)
      timers.current.push(
        window.setTimeout(() => setPhase('lower'), LOWER_AT),
        window.setTimeout(() => setPhase('result'), RESULT_AT)
      )
  }

  const close = () => {
    if (!open || phase !== 'result' || closing) return
    if (reducedMotion()) {
      finish()
      return
    }
    setClosing(true)
    timers.current = [window.setTimeout(finish, CLOSE_MS)]
  }

  // Phones: drag the sheet down to close it; short drags spring back.
  const sheetHandlers = {
    onPointerDown: (event: PointerEvent) => {
      if (phase !== 'result' || window.innerWidth >= 1024) return
      drag.current = { y: event.clientY, dy: 0 }
    },
    // Capture only once the press really drags, so a click on [닫기] still
    // reaches the link (QA: mouse clicks went to the sheet).
    onPointerMove: (event: PointerEvent) => {
      const sheet = sheetRef.current
      if (!drag.current || !sheet) return
      drag.current.dy = Math.max(0, event.clientY - drag.current.y)
      if (drag.current.dy < DRAG_START_PX) return
      const target = event.currentTarget
      if (!target.hasPointerCapture?.(event.pointerId)) {
        target.setPointerCapture?.(event.pointerId)
      }
      sheet.style.translate = `0 ${drag.current.dy}px`
    },
    onPointerUp: () => {
      const sheet = sheetRef.current
      const dy = drag.current?.dy ?? 0
      drag.current = null
      if (!sheet) return
      sheet.style.translate = ''
      if (dy >= DRAG_CLOSE_PX) close()
    }
  }

  return {
    open,
    closing,
    phase,
    again,
    played,
    pressed,
    announce,
    drawn,
    date,
    pick,
    start,
    close,
    onDialogClose,
    sheetHandlers,
    dialogRef,
    sheetRef,
    titleRef,
    buttonRef
  }
}
