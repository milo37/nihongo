import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useLatest } from '@common/hooks/useLatest'

export interface KeyboardShortcut {
  key: string
  onTrigger: (event: KeyboardEvent) => void
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  preventDefault?: boolean
}

interface ShortcutConfig {
  shortcuts: readonly KeyboardShortcut[]
  enabled: boolean
  ignoreEditableTargets: boolean
}

type UseKeyboardShortcutsOptions = {
  enabled?: boolean
  ignoreEditableTargets?: boolean
}

const shortcutRegistrations = new Map<symbol, RefObject<ShortcutConfig>>()

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false
  }

  return Boolean(
    target.closest(
      'textarea, select, input:not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]):not([type="reset"]), [contenteditable=""], [contenteditable="true"]'
    )
  )
}

const matchesShortcut = (
  event: KeyboardEvent,
  shortcut: KeyboardShortcut
): boolean => {
  return (
    event.key.toLocaleLowerCase() === shortcut.key.toLocaleLowerCase() &&
    event.altKey === Boolean(shortcut.altKey) &&
    event.ctrlKey === Boolean(shortcut.ctrlKey) &&
    event.metaKey === Boolean(shortcut.metaKey) &&
    event.shiftKey === Boolean(shortcut.shiftKey)
  )
}

const handleGlobalKeyDown = (event: KeyboardEvent): void => {
  if (event.defaultPrevented || event.isComposing) {
    return
  }

  for (const configRef of shortcutRegistrations.values()) {
    const { enabled, ignoreEditableTargets, shortcuts } = configRef.current

    if (!enabled || (ignoreEditableTargets && isEditableTarget(event.target))) {
      continue
    }

    for (const shortcut of shortcuts) {
      if (!matchesShortcut(event, shortcut)) {
        continue
      }

      if (shortcut.preventDefault !== false) {
        event.preventDefault()
      }

      shortcut.onTrigger(event)
      break
    }
  }
}

const subscribeToGlobalKeyDown = (
  registrationId: symbol,
  configRef: RefObject<ShortcutConfig>
): (() => void) => {
  const isFirstSubscriber = shortcutRegistrations.size === 0
  shortcutRegistrations.set(registrationId, configRef)

  if (isFirstSubscriber) {
    window.addEventListener('keydown', handleGlobalKeyDown)
  }

  return () => {
    shortcutRegistrations.delete(registrationId)

    if (shortcutRegistrations.size === 0) {
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }
}

export const useKeyboardShortcuts = (
  shortcuts: readonly KeyboardShortcut[],
  {
    enabled = true,
    ignoreEditableTargets = true
  }: UseKeyboardShortcutsOptions = {}
): void => {
  const configRef = useLatest({
    shortcuts,
    enabled,
    ignoreEditableTargets
  })

  useEffect(() => {
    const registrationId = Symbol('keyboard-shortcut-registration')
    return subscribeToGlobalKeyDown(registrationId, configRef)
  }, [configRef])
}
