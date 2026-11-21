import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import type { SsoAccountFlow } from '@app/account/hooks/useSsoAccountManagement'
import {
  TwoStepDescription,
  TwoStepNotices
} from '@app/account/components/TwoStepConfirmSections'
import { TwoStepSteps } from '@app/account/components/TwoStepSteps'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { ReauthButton } from '@nihongo/browser/app/reauth/components/ReauthButton'

type TwoStepConfirmDialogProps = {
  flow: SsoAccountFlow
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

// Account deletion and sign-in method unlink: ① verify with Google, then
// ② confirm. A still-valid verification opens directly at ②.
export const TwoStepConfirmDialog = ({
  flow,
  returnFocusRef,
  fallbackFocusRef
}: TwoStepConfirmDialogProps): ReactElement => {
  const { t } = useTranslation('account')
  const { t: authT } = useTranslation('auth')
  const cancel = useRef<HTMLButtonElement>(null)
  const alert = useRef<HTMLParagraphElement>(null)
  const dialog = flow.dialog
  const lastAdminBlocked = flow.feedback === 'lastAdminDeletionBlocked'
  // Design ⑦: on a phone the alert sits below the scrolled body. Bring it
  // into view and leave focus on [취소], the only action left.
  useEffect(() => {
    if (!lastAdminBlocked) return
    cancel.current?.focus({ preventScroll: true })
    alert.current?.scrollIntoView?.({ block: 'nearest' })
  }, [lastAdminBlocked])
  const isUnlink = dialog?.kind === 'unlink'
  const isConfirm = dialog?.step === 'confirm'
  const provider = 'Google'
  return (
    <Dialog
      size="sm"
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open) flow.closeDialog()
      }}
      title={
        isUnlink
          ? authT('sso.unlinkTitle', { provider })
          : authT('sso.deleteTitle')
      }
      preventClose={flow.busy}
      initialFocusRef={flow.returned ? undefined : cancel}
      returnFocusRef={returnFocusRef}
      fallbackFocusRef={fallbackFocusRef}
      footer={
        <>
          <Button
            ref={cancel}
            variant="outline"
            disabled={flow.busy}
            onClick={flow.closeDialog}
          >
            {authT('sso.cancel')}
          </Button>
          {flow.uncertain ? null : isConfirm ? (
            <Button
              variant="danger"
              // Design ⑦: the last administrator's refusal stays; only
              // [취소] is left, so the same request is not sent again.
              disabled={flow.busy || lastAdminBlocked}
              isLoading={flow.busy}
              loadingLabel={authT('sso.processing')}
              onClick={flow.confirm}
            >
              {isUnlink ? authT('sso.unlinkAction') : t('danger.action')}
            </Button>
          ) : (
            <ReauthButton
              variant="danger-outline"
              busy={flow.busy}
              disabled={!flow.canVerify}
              onClick={flow.verify}
            />
          )}
        </>
      }
    >
      {dialog ? (
        <>
          <TwoStepSteps isConfirm={isConfirm} isUnlink={isUnlink} />
          <TwoStepDescription
            canVerify={flow.canVerify}
            isConfirm={isConfirm}
            isUnlink={isUnlink}
            provider={provider}
          />
          <TwoStepNotices alertRef={alert} flow={flow} isConfirm={isConfirm} />
        </>
      ) : null}
    </Dialog>
  )
}
