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

// Failures never use a toast (they would vanish); they stay inline.
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

let toastIdSequence = 0

const createToastId = (): string => {
  toastIdSequence += 1
  return `toast-${toastIdSequence}`
}

export const Toast = ({
  action,
  description,
  durationMs,
  id,
  onDismiss,
  revision,
  title,
  variant = 'info'
}: ToastProps): ReactElement => {
  const { t } = useTranslation('common')
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    if (isPaused || !Number.isFinite(durationMs) || durationMs <= 0) {
      return
    }

    const timeout = window.setTimeout(() => onDismiss(id, false), durationMs)

    return () => window.clearTimeout(timeout)
  }, [durationMs, id, isPaused, onDismiss, revision])

  return (
    // The visible card has no live role; the provider's region announces it.
    <article
      className={classNames(
        'ui-toast pointer-events-auto grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-[12px] border border-line bg-surface py-3 pl-3.5 pr-1 text-ink shadow-soft',
        variantClassNames[variant]
      )}
      data-variant={variant}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onDismiss(id, true)
      }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
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
      <span className="ui-toast-icon" aria-hidden="true">
        {variantIcons[variant]}
      </span>
      <div className="min-w-0 py-0.5">
        <p className="break-words text-sm font-semibold leading-6">
          <span className="sr-only">{t(variantLabelKeys[variant])}: </span>
          {title}
        </p>
        {description ? (
          <p className="mt-0.5 break-words text-[13px] leading-5 text-muted">
            {description}
          </p>
        ) : null}
        {action ? (
          <button
            className="mt-2 min-h-11 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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

  const dismiss = useCallback((toastId: string, returnFocus: boolean): void => {
    const toast = toastsRef.current.find((entry) => entry.id === toastId)
    setToasts((current) => current.filter((entry) => entry.id !== toastId))
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
              ? { ...entry, ...toast, revision: entry.revision + 1 }
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
        <section className="ui-toast-region" aria-label={t('toast.region')}>
          {ordered.map((toast) => (
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
