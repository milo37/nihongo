import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'

export type MemoNotice =
  | 'saved'
  | 'deleted'
  | 'saveError'
  | 'saveOffline'
  | 'deleteError'
  | null

type WrongNoteMemoNoticeProps = {
  notice: MemoNotice
  noticeRef: RefObject<HTMLParagraphElement | null>
}

const checkIcon = (
  <svg
    aria-hidden="true"
    className="size-4 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const WrongNoteMemoNotice = ({
  notice,
  noticeRef
}: WrongNoteMemoNoticeProps): ReactElement | null => {
  const { t } = useTranslation('wrongNote')
  if (notice === 'saved')
    return (
      <p
        ref={noticeRef}
        className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-success"
        role="status"
        tabIndex={-1}
      >
        {checkIcon}
        {t('memo.saved')}
      </p>
    )
  if (notice === 'deleted')
    return (
      <p className="mt-2 text-sm font-semibold text-success" role="status">
        {t('memo.deleted')}
      </p>
    )
  if (notice)
    return (
      <p className="mt-2 text-sm font-semibold text-danger" role="alert">
        {t(`memo.${notice}`)}
      </p>
    )
  return null
}
