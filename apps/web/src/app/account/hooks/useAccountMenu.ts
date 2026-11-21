import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

const ITEM_SELECTOR = '[role="menuitem"]'

/**
 * The header account menu's open state and keys (WAI-ARIA menu button).
 * Arrow keys move between items, Escape closes and returns focus to the
 * trigger, and an outside click or another screen closes it.
 * JLP-849: only a keyboard open focuses the first item. A tap or click
 * focuses the menu box instead, because iOS Safari draws the keyboard ring
 * on any item focused by script.
 */
export const useAccountMenu = (pathname: string) => {
  // Where focus goes when the menu opens; null means closed.
  const [openAt, setOpenAt] = useState<'first' | 'menu' | null>(null)
  const open = openAt !== null
  const [closedPath, setClosedPath] = useState(pathname)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  if (closedPath !== pathname) {
    setClosedPath(pathname)
    setOpenAt(null)
  }
  const items = (): HTMLElement[] =>
    Array.from(
      panel.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []
    )
  useEffect(() => {
    if (!openAt) return
    if (openAt === 'first') items()[0]?.focus()
    else menu.current?.focus()
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setOpenAt(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [openAt])
  const close = (returnFocus: boolean): void => {
    setOpenAt(null)
    if (returnFocus) trigger.current?.focus()
  }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    const move = (next: number): void => {
      event.preventDefault()
      list[(next + list.length) % list.length]?.focus()
    }
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp')
      move(index < 0 ? list.length - 1 : index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(list.length - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') close(false)
  }
  return {
    open,
    setOpenAt,
    close,
    onMenuKeyDown,
    trigger,
    panel,
    menu,
    menuId
  }
}
