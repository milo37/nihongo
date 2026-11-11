import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import { ACCOUNT_FEEDBACK_KEY } from '@app/account/hooks/useSsoAccountManagement'
import type { SsoAccountFlow } from '@app/account/hooks/useSsoAccountManagement'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { ReauthButton } from '@nihongo/browser/app/reauth/components/ReauthButton'

export const DELETE_PARAGRAPHS = ['scope', 'reports', 'google'] as const

type TwoStepConfirmDialogProps = {
  flow: SsoAccountFlow
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

const StepMarker = ({
  index,
  label,
  state,
  doneLabel
}: {
  index: number
  label: string
  state: 'done' | 'current' | 'upcoming'
  doneLabel: string
}): ReactElement => (
  <li
    className="flex items-center gap-3"
    aria-current={state === 'current' ? 'step' : undefined}
  >
    <span
      className={[
        'grid size-7 shrink-0 place-items-center rounded-full text-caption font-bold',
        state === 'done'
          ? 'bg-success text-on-accent'
          : state === 'current'
            ? 'bg-brand text-on-accent'
            : 'border border-line bg-surface text-muted'
      ].join(' ')}
      aria-hidden="true"
    >
      {state === 'done' ? <Icon name="check" className="size-4" /> : index}
    </span>
    <span className={state === 'current' ? 'font-medium' : 'text-muted'}>
      {label}
      {state === 'done' ? <span className="sr-only"> {doneLabel}</span> : null}
    </span>
  </li>
)

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
  const dialog = flow.dialog
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
              disabled={
                flow.busy || flow.feedback === 'lastAdminDeletionBlocked'
              }
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
          <ol className="grid gap-3 text-sm">
            <StepMarker
              index={1}
              label={authT('reauth.name')}
              state={isConfirm ? 'done' : 'current'}
              doneLabel={authT('reauth.stepDone')}
            />
            <StepMarker
              index={2}
              label={t(isUnlink ? 'confirm.stepUnlink' : 'confirm.stepDelete')}
              state={isConfirm ? 'current' : 'upcoming'}
              doneLabel={authT('reauth.stepDone')}
            />
          </ol>
          <div className="mt-4 grid gap-2 break-words text-sm leading-6">
            {isUnlink ? (
              <p>{authT('sso.unlinkDescription', { provider })}</p>
            ) : isConfirm ? (
              DELETE_PARAGRAPHS.map((key) => (
                <p key={key}>{t(`confirm.deleteDescription.${key}`)}</p>
              ))
            ) : (
              <p className="whitespace-pre-line">{t('danger.description')}</p>
            )}
            {isConfirm && !isUnlink ? (
              <Link
                className="text-link text-caption underline"
                to="/account/data"
              >
                {t('dataGuide')}
              </Link>
            ) : null}
            {!isConfirm ? (
              <p className="text-caption text-muted">
                {flow.canVerify
                  ? authT('reauth.returnNote')
                  : authT('sso.unavailableProvider', { provider })}
              </p>
            ) : null}
            {!isConfirm ? (
              <p className="text-caption text-muted">
                {authT('reauth.scopeAccount')}
              </p>
            ) : null}
          </div>
          {isConfirm && flow.returned ? (
            <p
              className="mt-4 text-sm font-medium text-success-strong"
              role="status"
            >
              {authT('reauth.account.returned')}
            </p>
          ) : null}
          {flow.feedback ? (
            // Cancelling is not an error: a neutral box. Failures and an
            // expired check are a red error box.
            flow.feedback === 'reauthCancelled' ? (
              <p className="auth-notice mt-4" role="status">
                {authT(ACCOUNT_FEEDBACK_KEY[flow.feedback])}
              </p>
            ) : (
              <p className="auth-notice auth-error mt-4" role="alert">
                {authT(ACCOUNT_FEEDBACK_KEY[flow.feedback])}
              </p>
            )
          ) : null}
          {flow.uncertain ? (
            <Button
              className="mt-3"
              variant="outline"
              disabled={flow.busy}
              onClick={() => void flow.recheck()}
            >
              {authT('sso.recheck')}
            </Button>
          ) : null}
        </>
      ) : null}
    </Dialog>
  )
}
