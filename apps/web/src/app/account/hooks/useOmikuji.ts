import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { cachedStorage } from '@nihongo/browser/libs/storage'
import { pickOmikuji, seoulToday } from '@app/account/omikuji/pickOmikuji'

// Design v4/anim (1.5x, operator 11/20), from the moment the sheet opens:
// it rises for 380ms, Maru shakes for 800ms, holds the box low for 650ms,
// then the slip. Closing takes 280ms.
const LOWER_AT = 1195
const RESULT_AT = 1845
const CLOSE_MS = 280
// A phone sheet dragged down this far closes.
const DRAG_CLOSE_PX = 80

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

  const start = () => {
    const today = seoulToday()
    const key = drawnKey(userId, today)
    const seen = cachedStorage.getItem(key) !== null
    setDate(today)
    setAgain(seen)
    setClosing(false)
    setOpen(true)
    cachedStorage.setItem(key, '1')
    setDrawn(true)
    const play = !seen && !reducedMotion()
    setPlayed(play)
    if (!play) {
      setPhase('result')
      return
    }
    setPhase('shake')
    timers.current = [
      window.setTimeout(() => setPhase('lower'), LOWER_AT),
      window.setTimeout(() => setPhase('result'), RESULT_AT)
    ]
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
      event.currentTarget.setPointerCapture?.(event.pointerId)
      drag.current = { y: event.clientY, dy: 0 }
    },
    onPointerMove: (event: PointerEvent) => {
      const sheet = sheetRef.current
      if (!drag.current || !sheet) return
      drag.current.dy = Math.max(0, event.clientY - drag.current.y)
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
    drawn,
    date,
    pick,
    start,
    close,
    sheetHandlers,
    dialogRef,
    sheetRef,
    titleRef,
    buttonRef
  }
}
