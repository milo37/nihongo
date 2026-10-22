import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormEvent, ReactElement } from 'react'
import type { FreshAssuranceController } from '@app/admin-question/hooks/useFreshAssurance'
import { freshAssuranceReasonKey } from '@app/admin/presentation/adminPresentation'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { Input } from '@common/components/Input'

interface FreshAssuranceDialogProps {
  readonly controller: FreshAssuranceController
}

export const FreshAssuranceDialog = ({
  controller
}: FreshAssuranceDialogProps): ReactElement => {
  const { t } = useTranslation('admin')
  const [password, setPassword] = useState('')
  const [hasPasswordError, setHasPasswordError] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (
      controller.isOpen &&
      !controller.isPending &&
      !controller.recoveryRequired &&
      controller.errorMessage
    ) {
      passwordRef.current?.focus()
    }
  }, [
    controller.errorMessage,
    controller.isOpen,
    controller.isPending,
    controller.recoveryRequired
  ])

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (controller.isPending || controller.recoveryRequired) return
    if (password.length < 12) {
      setHasPasswordError(true)
      passwordRef.current?.focus()
      return
    }
    setHasPasswordError(false)
    void controller
      .reauthenticate(password)
      .catch(() => {
        setPassword('')
        passwordRef.current?.focus()
      })
      .then(() => setPassword(''))
  }

  const close = (): void => {
    if (controller.isPending) return
    setPassword('')
    setHasPasswordError(false)
    controller.close()
  }

  return (
    <Dialog
      initialFocusRef={passwordRef}
      open={controller.isOpen}
      preventClose={controller.isPending}
      title={t('freshAssurance.title')}
      description={
        controller.prompt
          ? t('freshAssurance.description', {
              reason: t(freshAssuranceReasonKey[controller.prompt.reasonCode])
            })
          : undefined
      }
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <form className="grid gap-5" noValidate onSubmit={handleSubmit}>
        <Input
          ref={passwordRef}
          autoComplete="current-password"
          disabled={controller.isPending || controller.recoveryRequired}
          error={
            controller.recoveryRequired
              ? undefined
              : hasPasswordError
                ? t('errors.fieldInvalid')
                : (controller.errorMessage ?? undefined)
          }
          label={t('freshAssurance.passwordLabel')}
          minLength={12}
          name="admin-password"
          required
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.currentTarget.value)
            setHasPasswordError(false)
          }}
        />
        {controller.recoveryRequired && controller.errorMessage ? (
          <p className="text-sm font-semibold text-red-700" role="alert">
            {controller.errorMessage}
          </p>
        ) : null}
        <p className="text-sm leading-6 text-muted" aria-live="polite">
          {t('freshAssurance.privacy')}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={controller.isPending}
            variant="outline"
            onClick={close}
          >
            {t('freshAssurance.cancel')}
          </Button>
          {controller.recoveryRequired ? (
            <Button
              isLoading={controller.isRecovering}
              loadingLabel={t('freshAssurance.checkingSession')}
              onClick={() =>
                void controller.retryRecovery().catch(() => undefined)
              }
            >
              {t('freshAssurance.retrySession')}
            </Button>
          ) : (
            <Button
              isLoading={controller.isPending}
              loadingLabel={t('freshAssurance.checking')}
              type="submit"
            >
              {t('freshAssurance.confirm')}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  )
}
