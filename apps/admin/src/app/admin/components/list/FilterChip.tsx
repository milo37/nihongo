import { Icon } from '@nihongo/browser/common/components/Icon'
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, Ref } from 'react'
import { AdminListIcon } from '@app/admin/components/list/AdminListIcon'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export type AdminListFilterOption = {
  readonly value: string
  readonly label: string
}

export type AdminListFilter = {
  readonly key: string
  readonly label: string
  readonly value: string | undefined
  readonly options: readonly AdminListFilterOption[]
  /** Undefined clears the filter. */
  readonly onChange: (value: string | undefined) => void
}

const chipClassName =
  'inline-flex min-h-9 items-center gap-1 rounded-control border text-sm font-semibold focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand'

export const filterValueLabel = (filter: AdminListFilter): string | undefined =>
  filter.options.find((option) => option.value === filter.value)?.label

/** Active value with its own clear button; also used in the mobile chip row. */
export const ActiveFilterChip = ({
  filter,
  onRemove = () => filter.onChange(undefined),
  onOpen,
  expanded,
  controls,
  buttonRef
}: {
  readonly filter: AdminListFilter
  readonly onRemove?: () => void
  readonly onOpen?: () => void
  readonly expanded?: boolean
  readonly controls?: string
  readonly buttonRef?: Ref<HTMLButtonElement>
}): ReactElement => {
  const { t } = useAdminPresentation()
  const value = filterValueLabel(filter) ?? filter.value
  const text = t('adminList.filters.chipValue', { label: filter.label, value })
  return (
    <span className="inline-flex min-h-9 items-stretch rounded-control border border-brand bg-brand-soft text-brand-strong">
      {onOpen ? (
        <button
          ref={buttonRef}
          type="button"
          className={`${chipClassName} border-transparent pl-3 pr-1`}
          aria-haspopup="listbox"
          aria-expanded={expanded}
          aria-controls={expanded ? controls : undefined}
          onClick={onOpen}
        >
          {text}
        </button>
      ) : (
        <span className="inline-flex items-center pl-3 pr-1 text-sm font-semibold">
          {text}
        </span>
      )}
      <button
        type="button"
        className={`${chipClassName} border-transparent px-2`}
        aria-label={t('adminList.filters.remove', { label: filter.label })}
        onClick={onRemove}
      >
        <Icon name="x" className="size-4" />
      </button>
    </span>
  )
}

/** Chip that opens a single-choice listbox; choosing applies at once. */
export const FilterChip = ({
  filter
}: {
  readonly filter: AdminListFilter
}): ReactElement => {
  const { t } = useAdminPresentation()
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const listbox = useRef<HTMLUListElement>(null)
  // The trigger is replaced when the value changes, so focus follows it once
  // the chosen value arrives from the URL.
  const pendingFocus = useRef<string | null>(null)
  useEffect(() => {
    if (pendingFocus.current !== (filter.value ?? '')) return
    pendingFocus.current = null
    trigger.current?.focus()
  })
  const options: readonly AdminListFilterOption[] = [
    { value: '', label: t('adminList.filters.all') },
    ...filter.options
  ]

  const openList = (): void => {
    const selected = options.findIndex(
      (option) => option.value === (filter.value ?? '')
    )
    setActive(Math.max(0, selected))
    setOpen(true)
  }
  const close = (returnFocus: boolean): void => {
    setOpen(false)
    if (returnFocus) trigger.current?.focus()
  }
  const choose = (value: string): void => {
    close(true)
    if (value === (filter.value ?? '')) return
    pendingFocus.current = value
    filter.onChange(value || undefined)
  }

  useEffect(() => {
    if (!open) return
    listbox.current?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const last = options.length - 1
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, active + 1),
      ArrowUp: Math.max(0, active - 1),
      Home: 0,
      End: last
    }
    if (event.key in moves) {
      event.preventDefault()
      setActive(moves[event.key] ?? 0)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(options[active]?.value ?? '')
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={container} className="relative flex min-h-11 items-center">
      {filter.value ? (
        <ActiveFilterChip
          filter={filter}
          onRemove={() => {
            pendingFocus.current = ''
            filter.onChange(undefined)
          }}
          onOpen={() => (open ? close(false) : openList())}
          expanded={open}
          controls={listboxId}
          buttonRef={trigger}
        />
      ) : (
        <button
          ref={trigger}
          type="button"
          className={`${chipClassName} border-line-interactive bg-surface px-3 text-ink hover:border-line-strong`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          onClick={() => (open ? close(false) : openList())}
        >
          {filter.label}
          <AdminListIcon name="chevron-down" className="size-4" />
        </button>
      )}
      {open ? (
        <ul
          ref={listbox}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-label={filter.label}
          aria-activedescendant={`${listboxId}-${active}`}
          className="absolute left-0 top-full z-30 mt-1 min-w-48 rounded-control border border-line bg-surface py-1 shadow-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => {
            const selected = option.value === (filter.value ?? '')
            return (
              <li
                key={option.value}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={selected}
                className={`flex min-h-11 cursor-pointer items-center gap-3 whitespace-nowrap px-3 text-sm ${index === active ? 'bg-surface-muted' : ''}`}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(option.value)}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-brand' : 'border-line-strong'}`}
                >
                  {selected ? (
                    <span className="size-2 rounded-full bg-brand" />
                  ) : null}
                </span>
                {option.label}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
