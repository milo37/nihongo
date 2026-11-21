import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import type { StartReviewNotice } from '@app/wrong-note/hooks/useStartReview'

type ReviewNoticesProps = {
  notice: StartReviewNotice | null
  offline: boolean
}

/** The offline line, then why [복습 시작] did not start, if it did not. */
export const ReviewNotices = ({
  notice,
  offline
}: ReviewNoticesProps): ReactElement => {
  // Left uncompiled: the compiled parent already caches this section, and
  // compiling it too adds about 200 bytes gzip (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('wrongNote')
  return (
    <>
      {offline ? (
        <p className="wrong-note-notice" role="status">
          {t('center.states.offline')}
        </p>
      ) : null}
      {notice === 'accountRestricted' ? (
        <AccountRestrictedNotice
          className="wrong-note-restricted"
          focusOnMount
        />
      ) : notice ? (
        <p className="wrong-note-error" role="alert">
          {t(notice === 'empty' ? 'startEmpty' : 'startError')}
        </p>
      ) : null}
    </>
  )
}
