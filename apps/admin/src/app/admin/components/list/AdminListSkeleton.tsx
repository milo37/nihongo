import type { ReactElement } from 'react'

const ROWS = 6

/** First load of a list: the table frame with grey rows and the same message. */
export const AdminListSkeleton = ({
  message
}: {
  readonly message: string
}): ReactElement => (
  <div className="rounded-card border border-line bg-surface">
    <div
      aria-hidden="true"
      className="h-11 border-b border-line bg-surface-muted"
    />
    <ul aria-hidden="true" className="divide-y divide-line">
      {Array.from({ length: ROWS }, (_, row) => (
        <li key={row} className="flex h-16 items-center gap-4 px-4">
          <span className="h-3 w-20 animate-pulse rounded-full bg-line motion-reduce:animate-none" />
          <span className="h-3 flex-1 animate-pulse rounded-full bg-line motion-reduce:animate-none" />
          <span className="hidden h-3 w-24 animate-pulse rounded-full bg-line motion-reduce:animate-none sm:block" />
        </li>
      ))}
    </ul>
    <p role="status" className="sr-only">
      {message}
    </p>
  </div>
)
