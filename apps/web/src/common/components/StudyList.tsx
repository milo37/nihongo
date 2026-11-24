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
  <div className="study-list-header">
    <div className="study-list-count">{count}</div>
    {aside ? (
      <div className="study-list-aside">{aside}</div>
    ) : null}
  </div>
)

// 20px rows (16px under 640px); no hover on rows that are not links.
const rowClassName = 'study-list-row'

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
  linkRef?: (node: HTMLAnchorElement | null) => void
}

export const StudyListRow = ({
  meta,
  text,
  sub,
  end,
  to,
  label,
  linkRef
}: StudyListRowProps): ReactElement => {
  const body = (
    <>
      <div className="study-list-body">
        <p className="study-list-meta">{meta}</p>
        <p
          className="study-list-text" lang="ja"
        >
          {text}
        </p>
        {sub ? <p className="study-list-sub">{sub}</p> : null}
      </div>
      {to || end ? (
        <span className="study-list-end">
          {end}
          {to ? <Icon name="chevron-right" className="study-list-chevron" /> : null}
        </span>
      ) : null}
    </>
  )
  return (
    <li className="study-list-item">
      {to ? (
        <Link
          className={`${rowClassName} study-list-link`}
          ref={linkRef}
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
  children,
  busy
}: {
  header: ReactNode
  children: ReactNode
  busy?: boolean
}): ReactElement => (
  <div className="study-list">
    {header}
    <ul aria-busy={busy || undefined}>{children}</ul>
  </div>
)
