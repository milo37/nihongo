import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import type { KeyboardEvent, ReactElement } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { UI_LOCALES } from '@nihongo/browser/i18n/types'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'

const ITEM_SELECTOR = '[role="menuitemradio"]'

// Top bar language menu (WAI-ARIA menu button). Opens on the current
// language; arrows wrap, Home/End jump, Escape and outside clicks close
// without a change. The choice stays in this browser only. JLP-849: a tap or
// click focuses the menu box, not the current language (iOS Safari rings
// any item focused by script); a keyboard open focuses the current language.
export const LocaleMenu = (): ReactElement => {
  const { t } = useTranslation('common')
  const { locale, setLocale } = useUiLocale()
  const { pathname } = useLocation()
  // Which item gets focus when the menu opens; null means closed.
  const [openAt, setOpenAt] = useState<'current' | 'last' | 'menu' | null>(null)
  const [closedPath, setClosedPath] = useState(pathname)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const open = openAt !== null
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
    const list = items()
    const start =
      openAt === 'last'
        ? list.at(-1)
        : list.find((item) => item.getAttribute('aria-checked') === 'true')
    if (openAt === 'menu') panel.current?.focus()
    else start?.focus()
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
  return (
    <div className="locale-menu">
      <button
        ref={trigger}
        type="button"
        className="locale-menu-trigger"
        aria-label={t('locale.change')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) =>
          // Enter and Space fire a click with detail 0.
          setOpenAt(open ? null : event.detail === 0 ? 'current' : 'menu')
        }
        onKeyDown={(event) => {
          if (open) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpenAt(event.key === 'ArrowUp' ? 'last' : 'current')
          }
        }}
      >
        <span className="locale-menu-icon">
          <Icon name="languages" className="size-5" />
        </span>
      </button>
      {open ? (
        <div
          ref={panel}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={t('locale.label')}
          className="locale-menu-panel"
          onKeyDown={onMenuKeyDown}
        >
          {UI_LOCALES.map((value) => (
            <button
              key={value}
              role="menuitemradio"
              type="button"
              lang={value}
              aria-checked={locale === value}
              className="locale-menu-item"
              onClick={() => {
                if (value !== locale) setLocale(value)
                close(true)
              }}
            >
              <span className="locale-menu-check">
                {locale === value ? (
                  <Icon name="check" className="size-5" />
                ) : null}
              </span>
              {t(`locale.${value}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
