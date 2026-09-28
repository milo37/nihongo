import { useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { FreshAssuranceController } from '@app/admin-question/hooks/useFreshAssurance'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { Input } from '@common/components/Input'

interface FreshAssuranceDialogProps {
  readonly controller: FreshAssuranceController
}

export const FreshAssuranceDialog = ({
  controller
}: FreshAssuranceDialogProps): ReactElement => {
  const [password, setPassword] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void controller
      .reauthenticate(password)
      .catch(() => {
        setPassword('')
        passwordRef.current?.focus()
      })
      .then(() => setPassword(''))
  }

  const close = (): void => {
    setPassword('')
    controller.close()
  }

  return (
    <Dialog
      initialFocusRef={passwordRef}
      open={controller.isOpen}
      preventClose={controller.isPending}
      title="관리자 본인 확인"
      description={
        controller.prompt
          ? `${controller.prompt.reason} 비밀번호 확인 후 작업 버튼을 다시 눌러야 합니다.`
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
          disabled={controller.recoveryRequired}
          error={
            controller.recoveryRequired
              ? undefined
              : (controller.errorMessage ?? undefined)
          }
          label="현재 비밀번호"
          minLength={12}
          name="admin-password"
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        {controller.recoveryRequired && controller.errorMessage ? (
          <p className="text-sm font-semibold text-red-700" role="alert">
            {controller.errorMessage}
          </p>
        ) : null}
        <p className="text-sm leading-6 text-muted" aria-live="polite">
          비밀번호는 저장하거나 원래 명령에 재사용하지 않습니다.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={controller.isPending}
            variant="outline"
            onClick={close}
          >
            취소
          </Button>
          {controller.recoveryRequired ? (
            <Button
              isLoading={controller.isRecovering}
              loadingLabel="로그인 상태 확인 중…"
              onClick={() =>
                void controller.retryRecovery().catch(() => undefined)
              }
            >
              로그인 상태 다시 확인
            </Button>
          ) : (
            <Button
              isLoading={controller.isPending}
              loadingLabel="확인 중…"
              type="submit"
            >
              본인 확인
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  )
}
