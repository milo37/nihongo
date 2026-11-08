import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'

// Success is a toast; only failures stay here, next to the memo.
export type MemoNotice =
  | 'saveError'
  | 'saveOffline'
  | 'deleteError'
  | null

type WrongNoteMemoNoticeProps = {
  notice: MemoNotice
}

export const WrongNoteMemoNotice = ({
  notice
}: WrongNoteMemoNoticeProps): ReactElement | null => {
  const { t } = useTranslation('wrongNote')
  if (notice)
    return (
      <p className="mt-2 text-sm font-semibold text-danger" role="alert">
        {t(`memo.${notice}`)}
      </p>
    )
  return null
}
