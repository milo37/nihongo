import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import type { SsoAccountFlow } from '@app/account/hooks/useSsoAccountManagement'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { Icon } from '@nihongo/browser/common/components/Icon'

export const DELETE_PARAGRAPHS = ['scope', 'reports', 'google'] as const

type TwoStepConfirmDialogProps = {
  flow: SsoAccountFlow
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

const StepMarker = ({
  index,
  label,
  state
}: {
  index: number
  label: string
  state: 'done' | 'current' | 'upcoming'
}): ReactElement => (
  <li
    className="flex items-center gap-3"
    aria-current={state === 'current' ? 'step' : undefined}
  >
    <span
      className={[
        'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold',
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
      initialFocusRef={cancel}
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
              disabled={flow.busy}
              isLoading={flow.busy}
              loadingLabel={authT('sso.processing')}
              onClick={flow.confirm}
            >
              {isUnlink ? authT('sso.unlinkAction') : t('danger.action')}
            </Button>
          ) : (
            <Button
              variant="danger-outline"
              disabled={flow.busy || !flow.canVerify}
              isLoading={flow.busy}
              loadingLabel={authT('sso.redirecting', { provider })}
              onClick={flow.verify}
            >
              {t('confirm.verifyAction')}
            </Button>
          )}
        </>
      }
    >
      {dialog ? (
        <>
          <ol className="grid gap-3 text-sm">
            <StepMarker
              index={1}
              label={t('confirm.stepVerify')}
              state={isConfirm ? 'done' : 'current'}
            />
            <StepMarker
              index={2}
              label={t(isUnlink ? 'confirm.stepUnlink' : 'confirm.stepDelete')}
              state={isConfirm ? 'current' : 'upcoming'}
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
              <Link className="text-link text-xs underline" to="/account/data">
                {t('dataGuide')}
              </Link>
            ) : null}
            {!isConfirm ? (
              <p className="text-xs text-muted">
                {flow.canVerify
                  ? t('confirm.verifyNote')
                  : authT('sso.unavailableProvider', { provider })}
              </p>
            ) : null}
          </div>
          {flow.feedback ? (
            <p className="mt-4 text-sm" role="alert">
              {authT('sso.' + flow.feedback)}
            </p>
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
