import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react'
import { Link } from 'react-router'
import { AdminListIcon } from '@app/admin/components/list/AdminListIcon'

export type RowActionItem =
  | {
      readonly key: string
      readonly label: string
      readonly to: string
      readonly danger?: false
    }
  | {
      readonly key: string
      readonly label: string
      readonly onSelect: () => void
      readonly danger?: boolean
    }
  | 'separator'

type RowActionMenuProps = {
  readonly label: string
  readonly items: readonly RowActionItem[]
}

const itemClassName =
  'flex min-h-11 w-full items-center whitespace-nowrap px-4 text-left text-sm font-semibold hover:bg-surface-muted focus:bg-surface-muted focus:outline-none'

/** Fixed position next to the button; null once the button is gone or off screen. */
const placeBeside = (
  button: HTMLButtonElement | null
): CSSProperties | null => {
  if (!button?.isConnected) return null
  const rect = button.getBoundingClientRect()
  if (rect.bottom < 0 || rect.top > window.innerHeight) return null
  const below = window.innerHeight - rect.bottom
  return {
    right: Math.max(8, window.innerWidth - rect.right),
    ...(below < 240 && rect.top > below
      ? { bottom: window.innerHeight - rect.top + 4 }
      : { top: rect.bottom + 4 })
  }
}

/**
 * `⋯` button with a menu. The menu is fixed to the viewport so a scrolling
 * table never clips it. Scrolling and resizing move it with its button; it
 * closes on an outside press, or when the button leaves the screen or the
 * row is removed.
 */
export const RowActionMenu = ({
  label,
  items
}: RowActionMenuProps): ReactElement => {
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const focusFirst = useRef(true)

  const menuItems = (): HTMLElement[] =>
    Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    )

  const show = (first: boolean): void => {
    const next = placeBeside(button.current)
    if (!next) return
    setPosition(next)
    focusFirst.current = first
    setOpen(true)
  }
  const hide = (returnFocus: boolean): void => {
    setOpen(false)
    if (returnFocus) button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const list = menuItems()
    ;(focusFirst.current ? list[0] : list.at(-1))?.focus()
    let frame = 0
    // One update per frame however many scroll events arrive.
    const follow = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const next = placeBeside(button.current)
        if (next) setPosition(next)
        else setOpen(false)
      })
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !button.current?.contains(target))
        setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open])

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      show(event.key === 'ArrowDown')
    }
  }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = menuItems()
    const index = list.indexOf(document.activeElement as HTMLElement)
    const targets: Record<string, HTMLElement | undefined> = {
      ArrowDown: list[(index + 1) % list.length],
      ArrowUp: list[(index - 1 + list.length) % list.length],
      Home: list[0],
      End: list.at(-1)
    }
    if (event.key in targets) {
      event.preventDefault()
      targets[event.key]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      hide(true)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="inline-grid size-9 place-items-center rounded-control border border-line-interactive bg-surface text-ink hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? hide(false) : show(true))}
        onKeyDown={onButtonKeyDown}
      >
        <AdminListIcon name="ellipsis" className="size-5" />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          style={position}
          className="fixed z-40 min-w-44 rounded-control border border-line bg-surface py-1 shadow-elevated"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <div
                key={`separator-${index}`}
                role="separator"
                className="my-1 border-t border-line"
              />
            ) : 'to' in item ? (
              <Link
                key={item.key}
                role="menuitem"
                tabIndex={-1}
                to={item.to}
                className={`${itemClassName} text-ink`}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`${itemClassName} ${item.danger ? 'text-danger' : 'text-ink'}`}
                onClick={() => {
                  hide(true)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </>
  )
}
