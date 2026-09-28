import { useId, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode
} from 'react'
import { classNames } from '@common/components/classNames'

export interface TabItem {
  id: string
  label: ReactNode
  panel: ReactNode
  disabled?: boolean
}

type TabsProps = {
  tabs: readonly TabItem[]
  label: string
  value?: string
  defaultValue?: string
  activationMode?: 'automatic' | 'manual'
  onValueChange?: (value: string) => void
  className?: string
  tabListClassName?: string
  panelClassName?: string
}

const getFirstEnabledTabId = (tabs: readonly TabItem[]): string | undefined => {
  return tabs.find((tab) => !tab.disabled)?.id
}

export const Tabs = ({
  activationMode = 'automatic',
  className,
  defaultValue,
  label,
  onValueChange,
  panelClassName,
  tabListClassName,
  tabs,
  value
}: TabsProps): ReactElement => {
  const generatedId = useId()
  const firstEnabledTabId = getFirstEnabledTabId(tabs)
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? firstEnabledTabId
  )
  const [focusedTabId, setFocusedTabId] = useState<string>()
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const requestedValue = value ?? uncontrolledValue
  const activeTab =
    tabs.find((tab) => tab.id === requestedValue && !tab.disabled) ??
    tabs.find((tab) => tab.id === firstEnabledTabId)
  const rovingTabId =
    tabs.find((tab) => tab.id === focusedTabId && !tab.disabled)?.id ??
    activeTab?.id

  const selectTab = (tabId: string): void => {
    setFocusedTabId(tabId)
    if (value === undefined) {
      setUncontrolledValue(tabId)
    }
    onValueChange?.(tabId)
  }

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentTabId: string
  ): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return
    }

    const enabledTabs = tabs.filter((tab) => !tab.disabled)
    if (enabledTabs.length === 0) {
      return
    }

    const currentIndex = enabledTabs.findIndex((tab) => tab.id === currentTabId)
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabledTabs.length - 1
          : event.key === 'ArrowRight'
            ? (currentIndex + 1) % enabledTabs.length
            : (currentIndex - 1 + enabledTabs.length) % enabledTabs.length
    const nextTab = enabledTabs[nextIndex]
    if (!nextTab) {
      return
    }

    event.preventDefault()
    setFocusedTabId(nextTab.id)
    tabRefs.current.get(nextTab.id)?.focus()
    if (activationMode === 'automatic') {
      selectTab(nextTab.id)
    }
  }

  return (
    <div className={classNames('min-w-0', className)}>
      <div
        className={classNames(
          'flex min-w-0 gap-1 overflow-x-auto rounded-control bg-surface-muted p-1',
          tabListClassName
        )}
        role="tablist"
        aria-label={label}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocusedTabId(undefined)
          }
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab?.id
          const tabId = `${generatedId}-tab-${tab.id}`
          const panelId = `${generatedId}-panel-${tab.id}`

          return (
            <button
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element)
                else tabRefs.current.delete(tab.id)
              }}
              className={classNames(
                'ui-tab min-h-11 flex-1 whitespace-nowrap rounded-control px-4 py-2 text-sm font-semibold',
                'touch-manipulation transition-[background-color,color,box-shadow] duration-150',
                'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isActive
                  ? 'bg-surface text-ink shadow-control'
                  : 'text-muted hover:bg-surface/70 hover:text-ink'
              )}
              id={tabId}
              key={tab.id}
              type="button"
              role="tab"
              aria-controls={panelId}
              aria-selected={isActive}
              disabled={tab.disabled}
              tabIndex={tab.id === rovingTabId ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, tab.id)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab ? (
        <div
          className={classNames('mt-4 min-w-0', panelClassName)}
          id={`${generatedId}-panel-${activeTab.id}`}
          role="tabpanel"
          aria-labelledby={`${generatedId}-tab-${activeTab.id}`}
          tabIndex={0}
        >
          {activeTab.panel}
        </div>
      ) : null}
    </div>
  )
}
