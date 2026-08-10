import { useEffect, useId, useRef } from 'react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { IconButton } from '@common/components/IconButton'
import { classNames } from '@common/components/classNames'

type DialogSize = 'sm' | 'md' | 'lg'

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  closeLabel?: string
  size?: DialogSize
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
}

const openDialogs = new Set<HTMLDialogElement>()

const syncPageScrollLock = (): void => {
  document.documentElement.classList.toggle('has-modal', openDialogs.size > 0)
}

const sizeClassNames: Record<DialogSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl'
}

const closeIcon = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="m6 6 12 12M18 6 6 18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  </svg>
)

export const Dialog = ({
  children,
  className,
  closeLabel = '대화상자 닫기',
  description,
  footer,
  initialFocusRef,
  onOpenChange,
  open,
  size = 'md',
  title
}: DialogProps): ReactElement => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current

    if (!dialog) {
      return
    }

    if (open && !dialog.open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null

      if (typeof dialog.showModal === 'function') {
        dialog.showModal()
      } else {
        dialog.setAttribute('open', '')
      }

      openDialogs.add(dialog)
      syncPageScrollLock()

      const frameId = window.requestAnimationFrame(() => {
        const focusTarget = initialFocusRef?.current ?? titleRef.current
        focusTarget?.focus()
      })

      return () => window.cancelAnimationFrame(frameId)
    }

    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close()
      } else {
        dialog.removeAttribute('open')
      }
      openDialogs.delete(dialog)
      syncPageScrollLock()
      previousFocusRef.current?.focus()
    }
  }, [initialFocusRef, open])

  useEffect(() => {
    const dialog = dialogRef.current

    return () => {
      if (dialog) {
        openDialogs.delete(dialog)
        syncPageScrollLock()
      }
    }
  }, [])

  const requestClose = (): void => {
    onOpenChange(false)
  }

  return (
    <dialog
      ref={dialogRef}
      className={classNames(
        'ui-dialog m-auto max-h-[min(90dvh,56rem)] w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-line bg-white p-0 text-ink shadow-2xl',
        sizeClassNames[size],
        className
      )}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onClose={() => {
        const dialog = dialogRef.current

        if (dialog) {
          openDialogs.delete(dialog)
        }
        syncPageScrollLock()
        previousFocusRef.current?.focus()

        if (open) {
          onOpenChange(false)
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestClose()
        }
      }}
    >
      <div className="flex max-h-[min(90dvh,56rem)] flex-col overscroll-contain">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              ref={titleRef}
              className="scroll-mt-24 text-balance text-xl font-bold"
              id={titleId}
              tabIndex={-1}
            >
              {title}
            </h2>
            {description ? (
              <p
                className="mt-2 break-words text-sm leading-6 text-muted"
                id={descriptionId}
              >
                {description}
              </p>
            ) : null}
          </div>
          <IconButton
            className="-mr-2 -mt-1"
            label={closeLabel}
            icon={closeIcon}
            variant="ghost"
            onClick={requestClose}
          />
        </div>
        {children ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
            {children}
          </div>
        ) : null}
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  )
}
