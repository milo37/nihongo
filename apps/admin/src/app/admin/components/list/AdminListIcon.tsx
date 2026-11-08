import type { ReactElement } from 'react'

// Lucide source SVGs: https://github.com/lucide-icons/lucide/tree/main/icons (ISC).
// Admin list icons the shared Icon set does not carry.
export type AdminListIconName =
  | 'ellipsis'
  | 'copy'
  | 'search'
  | 'chevron-down'
  | 'sliders-horizontal'

const paths: Record<AdminListIconName, ReactElement> = {
  ellipsis: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>
  ),
  copy: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  search: (
    <>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>
  ),
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'sliders-horizontal': (
    <>
      <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3" />
      <path d="M14 2v4M8 10v4M16 18v4" />
    </>
  )
}

export const AdminListIcon = ({
  name,
  className
}: {
  name: AdminListIconName
  className?: string
}): ReactElement => (
  <svg
    className={className}
    width={20}
    height={20}
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {paths[name]}
  </svg>
)
