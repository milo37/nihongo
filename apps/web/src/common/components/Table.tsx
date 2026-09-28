import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

type TableProps = Omit<ComponentPropsWithoutRef<'table'>, 'children'> & {
  caption: string
  children: ReactNode
  descriptionId?: string
  scrollLabel?: string
  captionVisibility?: 'visible' | 'sr-only'
  containerClassName?: string
  minWidthClassName?: string
}

export type TableSortDirection = 'ascending' | 'descending'

type TableSortHeaderProps = Omit<
  ComponentPropsWithoutRef<'th'>,
  'aria-sort' | 'children'
> & {
  children: ReactNode
  direction?: TableSortDirection
  onSort: () => void
  sortLabel: string
}

export const TableSortHeader = ({
  children,
  className,
  direction,
  onSort,
  scope = 'col',
  sortLabel,
  ...props
}: TableSortHeaderProps): ReactElement => {
  const indicator =
    direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : '↕'

  return (
    <th
      {...props}
      className={classNames('p-0', className)}
      scope={scope}
      aria-sort={direction}
    >
      <button
        className={classNames(
          'inline-flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left font-bold',
          'hover:bg-surface-sunken focus-visible:outline focus-visible:outline-focus',
          'focus-visible:outline-offset-focus-inset focus-visible:outline-brand'
        )}
        type="button"
        aria-label={sortLabel}
        onClick={onSort}
      >
        <span>{children}</span>
        <span aria-hidden="true">{indicator}</span>
      </button>
    </th>
  )
}

export const Table = ({
  caption,
  captionVisibility = 'sr-only',
  children,
  className,
  containerClassName,
  descriptionId,
  minWidthClassName = 'min-w-[40rem]',
  scrollLabel = caption,
  ...props
}: TableProps): ReactElement => {
  return (
    <div
      className={classNames(
        'scrollbar-gutter-stable overflow-x-auto rounded-card border border-line bg-surface',
        'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
        containerClassName
      )}
      role="region"
      aria-describedby={descriptionId}
      aria-label={scrollLabel}
      tabIndex={0}
    >
      <table
        className={classNames(
          'w-full border-collapse text-left text-sm',
          minWidthClassName,
          className
        )}
        {...props}
      >
        <caption
          className={
            captionVisibility === 'sr-only'
              ? 'sr-only'
              : 'px-4 py-3 text-left font-bold text-ink'
          }
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  )
}
