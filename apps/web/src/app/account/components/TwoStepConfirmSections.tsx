import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import { ACCOUNT_FEEDBACK_KEY } from '@app/account/hooks/useSsoAccountManagement'
import type { SsoAccountFlow } from '@app/account/hooks/useSsoAccountManagement'
import { Button } from '@nihongo/browser/common/components/Button'

export const DELETE_PARAGRAPHS = ['scope', 'reports', 'google'] as const

/** What the step means; at ② of deletion, the data guide link. */
export const TwoStepDescription = ({
  canVerify,
  isConfirm,
  isUnlink,
  provider
}: {
  canVerify: boolean
  isConfirm: boolean
  isUnlink: boolean
  provider: string
}): ReactElement => {
  'use no memo'
  const { t } = useTranslation('account')
  const { t: authT } = useTranslation('auth')
  return (
    <div className="two-step-text">
      {isUnlink ? (
        <p>{authT('sso.unlinkDescription', { provider })}</p>
      ) : isConfirm ? (
        DELETE_PARAGRAPHS.map((key) => (
          <p key={key}>{t(`confirm.deleteDescription.${key}`)}</p>
        ))
      ) : (
        <p className="two-step-pre">{t('danger.description')}</p>
      )}
      {isConfirm && !isUnlink ? (
        <Link className="two-step-data-link" to="/account/data">
          {t('dataGuide')}
        </Link>
      ) : null}
      {!isConfirm ? (
        <p className="two-step-note">
          {canVerify
            ? authT('reauth.returnNote')
            : authT('sso.unavailableProvider', { provider })}
        </p>
      ) : null}
      {!isConfirm ? (
        <p className="two-step-note">{authT('reauth.scopeAccount')}</p>
      ) : null}
    </div>
  )
}

/** Back from Google, the result of the last try, and [다시 확인]. */
export const TwoStepNotices = ({
  alertRef,
  flow,
  isConfirm
}: {
  alertRef: RefObject<HTMLParagraphElement | null>
  flow: SsoAccountFlow
  isConfirm: boolean
}): ReactElement => {
  'use no memo'
  const { t: authT } = useTranslation('auth')
  return (
    <>
      {isConfirm && flow.returned ? (
        <p className="two-step-returned" role="status">
          {authT('reauth.account.returned')}
        </p>
      ) : null}
      {flow.feedback ? (
        // Cancelling is not an error: a neutral box. Failures and an
        // expired check are a red error box.
        flow.feedback === 'reauthCancelled' ? (
          <p className="auth-notice two-step-notice" role="status">
            {authT(ACCOUNT_FEEDBACK_KEY[flow.feedback])}
          </p>
        ) : (
          <p
            ref={alertRef}
            className="auth-notice auth-error two-step-notice"
            role="alert"
          >
            {authT(ACCOUNT_FEEDBACK_KEY[flow.feedback])}
          </p>
        )
      ) : null}
      {flow.uncertain ? (
        <Button
          className="two-step-recheck"
          variant="outline"
          disabled={flow.busy}
          onClick={() => void flow.recheck()}
        >
          {authT('sso.recheck')}
        </Button>
      ) : null}
    </>
  )
}
