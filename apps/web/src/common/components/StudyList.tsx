import { Link } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'

/**
 * Shared list rules (ux2 §1): one header line, then rows of meta, question
 * (two lines at most), a sub line and an end cell. Sizes stay at 12·13·15·17px.
 */
type StudyListHeaderProps = {
  /** e.g. '10문제'. */
  count: ReactNode
  /** Sort text and the filter button; hidden by the caller at 0 rows. */
  aside?: ReactNode
}

export const StudyListHeader = ({
  count,
  aside
}: StudyListHeaderProps): ReactElement => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3">
    <p className="text-[15px] font-bold">{count}</p>
    {aside ? (
      <div className="flex items-center gap-3 text-sm text-muted">{aside}</div>
    ) : null}
  </div>
)

// 20px rows (16px under 640px); no hover on rows that are not links.
const rowClassName = 'flex min-h-11 items-center gap-4 py-4 sm:py-5'

type StudyListRowProps = {
  meta: ReactNode
  /** Japanese question text, cut after two lines. */
  text: ReactNode
  sub?: ReactNode
  /** Status chip, or an icon button when the row is not a link. */
  end?: ReactNode
  /** Makes the whole row one link; no other button goes inside then. */
  to?: string
  /** Screen-reader name of the row link. */
  label?: string
}

export const StudyListRow = ({
  meta,
  text,
  sub,
  end,
  to,
  label
}: StudyListRowProps): ReactElement => {
  const body = (
    <>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="text-xs font-semibold text-muted">{meta}</p>
        <p
          className="line-clamp-2 text-base leading-relaxed sm:text-[17px]"
          lang="ja"
        >
          {text}
        </p>
        {sub ? <p className="text-[13px] text-muted">{sub}</p> : null}
      </div>
      {to || end ? (
        <span className="flex shrink-0 items-center gap-2">
          {end}
          {to ? <Icon name="chevron-right" className="text-muted" /> : null}
        </span>
      ) : null}
    </>
  )
  return (
    <li className="border-b border-line">
      {to ? (
        <Link
          className={`${rowClassName} hover:bg-surface-muted`}
          to={to}
          aria-label={label}
        >
          {body}
        </Link>
      ) : (
        <div className={rowClassName}>{body}</div>
      )}
    </li>
  )
}

/** The list column: header line, then rows (`StudyListRow`). */
export const StudyList = ({
  header,
  children
}: {
  header: ReactNode
  children: ReactNode
}): ReactElement => (
  <div className="max-w-[760px]">
    {header}
    <ul>{children}</ul>
  </div>
)
