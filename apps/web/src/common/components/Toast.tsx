import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import type { ReactElement, ReactNode } from 'react'
import { IconButton } from '@common/components/IconButton'
import { classNames } from '@common/components/classNames'

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger'

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
}

interface ToastRecord extends ToastInput {
  id: string
}

interface ToastContextValue {
  addToast: (toast: ToastInput) => string
  dismissToast: (toastId: string) => void
}

type ToastProviderProps = {
  children: ReactNode
  defaultDurationMs?: number
  maxVisible?: number
}

type ToastProps = ToastRecord & {
  defaultDurationMs: number
  onDismiss: (toastId: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const variantClassNames: Record<ToastVariant, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-950',
  success: 'border-green-200 bg-green-50 text-green-950',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  danger: 'border-red-200 bg-red-50 text-red-950'
}

const variantLabels: Record<ToastVariant, string> = {
  info: '안내',
  success: '성공',
  warning: '주의',
  danger: '오류'
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
  defaultDurationMs,
  description,
  durationMs,
  id,
  onDismiss,
  title,
  variant = 'info'
}: ToastProps): ReactElement => {
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    const timeoutDuration = durationMs ?? defaultDurationMs

    if (isPaused || !Number.isFinite(timeoutDuration) || timeoutDuration <= 0) {
      return
    }

    const timeout = window.setTimeout(() => onDismiss(id), timeoutDuration)

    return () => window.clearTimeout(timeout)
  }, [defaultDurationMs, durationMs, id, isPaused, onDismiss])

  return (
    <article
      className={classNames(
        'ui-toast pointer-events-auto grid grid-cols-[1fr_auto] gap-3 rounded-xl border p-4 shadow-soft',
        variantClassNames[variant]
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
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
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide opacity-75">
          {variantLabels[variant]}
        </p>
        <p className="mt-1 break-words font-bold">{title}</p>
        {description ? (
          <p className="mt-1 break-words text-sm leading-6 opacity-80">
            {description}
          </p>
        ) : null}
        {action ? (
          <button
            className="mt-3 min-h-11 rounded-md px-2 text-sm font-bold underline decoration-1 underline-offset-4 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            type="button"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <IconButton
        className="-mr-2 -mt-2"
        label="알림 닫기"
        icon={closeIcon}
        size="sm"
        variant="ghost"
        onClick={() => onDismiss(id)}
      />
    </article>
  )
}

export const ToastProvider = ({
  children,
  defaultDurationMs = 4500,
  maxVisible = 3
}: ToastProviderProps): ReactElement => {
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  const dismissToast = useCallback((toastId: string): void => {
    setToasts((currentToasts) =>
      currentToasts.filter((toast) => toast.id !== toastId)
    )
  }, [])

  const addToast = useCallback(
    (toast: ToastInput): string => {
      const id = createToastId()
      const safeMaxVisible =
        Number.isFinite(maxVisible) && maxVisible > 0
          ? Math.floor(maxVisible)
          : 1

      setToasts((currentToasts) =>
        [...currentToasts, { ...toast, id }].slice(-safeMaxVisible)
      )

      return id
    },
    [maxVisible]
  )

  const contextValue = useMemo<ToastContextValue>(
    () => ({ addToast, dismissToast }),
    [addToast, dismissToast]
  )

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] ml-auto grid max-w-md gap-3"
        aria-label="알림"
      >
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            defaultDurationMs={defaultDurationMs}
            onDismiss={dismissToast}
          />
        ))}
      </div>
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
