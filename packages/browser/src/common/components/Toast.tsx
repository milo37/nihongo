import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { IconButton } from './IconButton'
import { classNames } from './classNames'

export type ToastVariant = 'info' | 'success' | 'warning'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  durationMs?: number
  action?: ToastAction
  /** Only one toast per key: a repeat restarts its timer instead of stacking. */
  key?: string
  /** Stays until dismissed (offline), pinned at the top of the stack. */
  persistent?: boolean
}

interface ToastRecord extends ToastInput {
  id: string
  /** Bumped when a toast with the same key comes again, to restart its timer. */
  revision: number
  /** Element to return focus to when the toast is closed from inside. */
  opener: Element | null
  /** Playing its exit; removed when that ends (#1263). */
  closing?: boolean
}

interface ToastContextValue {
  addToast: (toast: ToastInput) => string
  dismissToast: (toastId: string) => void
}

type ToastProviderProps = {
  children: ReactNode
  defaultDurationMs?: number
  actionDurationMs?: number
  maxVisible?: number
}

type ToastProps = ToastRecord & {
  durationMs: number
  onDismiss: (toastId: string, returnFocus: boolean) => void
  onExited: (toastId: string) => void
}

export const TOAST_ANNOUNCER_ID = 'toast-announcer'

const ToastContext = createContext<ToastContextValue | null>(null)

const variantClassNames: Record<ToastVariant, string> = {
  info: 'ui-toast-info',
  success: 'ui-toast-success',
  warning: 'ui-toast-warning'
}

const variantLabelKeys = {
  info: 'toast.info',
  success: 'toast.success',
  warning: 'toast.warning'
} as const satisfies Record<ToastVariant, string>

const variantIcons: Record<ToastVariant, string> = {
  info: 'i',
  success: '✓',
  warning: '!'
}

const closeIcon = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="m7 7 10 10M17 7 7 17"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  </svg>
)

// #1263: a tap fires mouseenter (and focus) with no mouseleave or blur, so
// pausing there would keep a touched toast open for good. Only a mouse or
// trackpad pauses it.
const canPauseOnHover = (): boolean =>
  window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true

// The exit's length, read from the stylesheet (--motion-toast). 0 when no
// exit animation runs (reduced motion ends it at once; jsdom has none).
const exitDurationMs = (element: Element): number => {
  const style = getComputedStyle(element)
  if (!style.animationName.includes('ui-toast-out')) return 0
  const ms = parseFloat(style.animationDuration) * 1000
  return Number.isFinite(ms) ? ms : 0
}

let toastIdSequence = 0

const createToastId = (): string => {
  toastIdSequence += 1
  return `toast-${toastIdSequence}`
}

export const Toast = ({
  action,
  closing = false,
  description,
  durationMs,
  id,
  onDismiss,
  onExited,
  revision,
  title,
  variant = 'info'
}: ToastProps): ReactElement => {
  const { t } = useTranslation('common')
  const [isPaused, setIsPaused] = useState(false)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (
      closing ||
      isPaused ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    ) {
      return
    }

    const timeout = window.setTimeout(() => onDismiss(id, false), durationMs)

    return () => window.clearTimeout(timeout)
  }, [closing, durationMs, id, isPaused, onDismiss, revision])

  // Removed when the exit ends; the timer covers an animationend that never
  // comes (a hidden tab).
  useEffect(() => {
    const element = ref.current
    if (!closing || !element) return
    const exitMs = exitDurationMs(element)
    if (exitMs === 0) {
      onExited(id)
      return
    }
    const timeout = window.setTimeout(() => onExited(id), exitMs)
    return () => window.clearTimeout(timeout)
  }, [closing, id, onExited])

  return (
    // The visible card has no live role; the provider's region announces it.
    // Top/right borders only: .ui-toast draws the 4px tone strip on the left.
    <article
      ref={ref}
      className={classNames(
        // Styles: packages/browser/src/styles/feedback.css (#1186 C10).
        'ui-toast',
        // A title alone sits in the middle of the close button's height
        // instead of leaving the space under it empty.
        description || action ? 'ui-toast-top' : 'ui-toast-middle',
        closing ? 'ui-toast-closing' : 'ui-toast-open',
        variantClassNames[variant]
      )}
      data-variant={variant}
      data-state={closing ? 'closing' : undefined}
      inert={closing}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) onExited(id)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onDismiss(id, true)
      }}
      onMouseEnter={() => {
        if (canPauseOnHover()) setIsPaused(true)
      }}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => {
        if (canPauseOnHover()) setIsPaused(true)
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget

        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsPaused(false)
        }
      }}
    >
      <span
        className={classNames(
          'ui-toast-icon',
          description || action ? 'ui-toast-icon-top' : null
        )}
        aria-hidden="true"
      >
        {variantIcons[variant]}
      </span>
      <div className="ui-toast-body">
        <p className="ui-toast-title">
          <span className="sr-only">{t(variantLabelKeys[variant])}: </span>
          {title}
        </p>
        {description ? (
          <p className="ui-toast-description">{description}</p>
        ) : null}
        {action ? (
          <button
            className="ui-toast-action"
            type="button"
            onClick={() => {
              action.onClick()
              onDismiss(id, false)
            }}
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <IconButton
        label={t('actions.closeNotification')}
        icon={closeIcon}
        variant="ghost"
        onClick={() => onDismiss(id, true)}
      />
    </article>
  )
}

const announcementFor = (toast: ToastInput, variantLabel: string): string =>
  [`${variantLabel}: ${toast.title}`, toast.description]
    .filter(Boolean)
    .join(' ')

export const ToastProvider = ({
  children,
  defaultDurationMs = 5000,
  actionDurationMs = 8000,
  maxVisible = 3
}: ToastProviderProps): ReactElement => {
  const { t } = useTranslation('common')
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const [announcement, setAnnouncement] = useState('')
  const toastsRef = useRef(toasts)
  useLayoutEffect(() => {
    toastsRef.current = toasts
  }, [toasts])

  // Closing first: the toast plays its exit, then onExited removes it.
  const dismiss = useCallback((toastId: string, returnFocus: boolean): void => {
    const toast = toastsRef.current.find((entry) => entry.id === toastId)
    setToasts((current) =>
      current.map((entry) =>
        entry.id === toastId ? { ...entry, closing: true } : entry
      )
    )
    if (!returnFocus || !toast) return
    const opener = toast.opener
    const target =
      opener instanceof HTMLElement &&
      opener !== document.body &&
      opener.isConnected
        ? opener
        : document.querySelector<HTMLElement>('main')
    target?.focus()
  }, [])

  const removeToast = useCallback((toastId: string): void => {
    setToasts((current) => current.filter((entry) => entry.id !== toastId))
  }, [])

  const dismissToast = useCallback(
    (toastId: string): void => dismiss(toastId, false),
    [dismiss]
  )

  const addToast = useCallback(
    (toast: ToastInput): string => {
      const safeMaxVisible =
        Number.isFinite(maxVisible) && maxVisible > 0
          ? Math.floor(maxVisible)
          : 1
      const existing = toast.key
        ? toastsRef.current.find((entry) => entry.key === toast.key)
        : undefined
      const id = existing?.id ?? createToastId()
      const opener =
        typeof document === 'undefined' ? null : document.activeElement

      setToasts((current) => {
        const same = current.find((entry) => entry.id === id)
        if (same) {
          return current.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  ...toast,
                  closing: false,
                  revision: entry.revision + 1
                }
              : entry
          )
        }
        let next = [...current, { ...toast, id, revision: 0, opener }]
        // Drop the oldest non-persistent toasts first.
        while (next.length > safeMaxVisible) {
          const oldest = next.findIndex((entry) => !entry.persistent)
          next = next.filter(
            (_, index) => index !== (oldest === -1 ? 0 : oldest)
          )
        }
        return next
      })
      setAnnouncement(
        announcementFor(toast, t(variantLabelKeys[toast.variant ?? 'info']))
      )

      return id
    },
    [maxVisible, t]
  )

  // #1262: the stack's height is --toast-stack-height, so a screen can keep
  // its last option and buttons scrollable above the toasts. At the page
  // end, the page moves up with a growing stack.
  const regionRef = useRef<HTMLElement>(null)
  const hasToasts = toasts.length > 0
  useEffect(() => {
    const region = regionRef.current
    const root = document.documentElement
    if (!region || typeof ResizeObserver === 'undefined') return
    let height = 0
    const observer = new ResizeObserver(() => {
      const next = region.offsetHeight
      const atEnd = window.innerHeight + window.scrollY >= root.scrollHeight - 1
      root.style.setProperty('--toast-stack-height', `${next}px`)
      if (atEnd && next > height) window.scrollBy(0, next - height)
      height = next
    })
    observer.observe(region)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--toast-stack-height')
    }
  }, [hasToasts])

  const contextValue = useMemo<ToastContextValue>(
    () => ({ addToast, dismissToast }),
    [addToast, dismissToast]
  )

  // Persistent toasts stay on top; the newest sits nearest the screen edge.
  const ordered = [
    ...toasts.filter((toast) => toast.persistent),
    ...toasts.filter((toast) => !toast.persistent)
  ]

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {/* Always present so the first toast is announced too. No status
          role: screens keep their own status regions unambiguous. */}
      <div
        id={TOAST_ANNOUNCER_ID}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
      {ordered.length > 0 ? (
        <section
          ref={regionRef}
          className="ui-toast-region"
          aria-label={t('toast.region')}
        >
          {ordered.map(({ key: _dedupeKey, ...toast }) => (
            <Toast
              key={toast.id}
              {...toast}
              durationMs={
                toast.persistent
                  ? Number.POSITIVE_INFINITY
                  : (toast.durationMs ??
                    (toast.action ? actionDurationMs : defaultDurationMs))
              }
              onDismiss={dismiss}
              onExited={removeToast}
            />
          ))}
        </section>
      ) : null}
    </ToastContext.Provider>
  )
}

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }

  return context
}

/**
 * #1262: a failed press is said in a warning toast, not a line on the
 * screen; the button stays where it was, so no retry in the toast. Fires
 * each time the title appears (a new press clears it first).
 */
export const useErrorToast = (title: string | null, key: string): void => {
  const { addToast } = useToast()
  useEffect(() => {
    if (title) addToast({ key, title, variant: 'warning' })
  }, [title, key, addToast])
}

/**
 * #1292: something that loads by itself failed and its block is hidden, so
 * the toast carries [다시 시도]. It goes when the load works again.
 */
export const useRetryToast = (
  title: string | null,
  key: string,
  onRetry: () => void
): void => {
  const { t } = useTranslation('common')
  const { addToast, dismissToast } = useToast()
  const retryRef = useRef(onRetry)
  useEffect(() => {
    retryRef.current = onRetry
  }, [onRetry])
  useEffect(() => {
    if (!title) return
    const id = addToast({
      key,
      title,
      variant: 'warning',
      action: { label: t('actions.retry'), onClick: () => retryRef.current() }
    })
    return () => dismissToast(id)
  }, [title, key, retryRef, addToast, dismissToast, t])
}
