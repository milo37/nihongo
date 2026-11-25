import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { useLogoutUser } from '@app/account/hooks/useLogoutUser'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'

type LogoutDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocusRef: RefObject<HTMLElement | null>
}

// Shared by the account menu and the account page. On success the session
// ends, the app returns to / and a toast confirms the sign-out.
export const LogoutDialog = ({
  open,
  onOpenChange,
  returnFocusRef
}: LogoutDialogProps): ReactElement => {
  const { t } = useTranslation('auth')
  const logout = useLogoutUser()
  const cancel = useRef<HTMLButtonElement>(null)
  // #1292: a failure closes the dialog; the toast says it, and [로그아웃]
  // on the page opens it again. After an unknown result that press first
  // asks the server whether the session already ended.
  const closeRef = useRef(onOpenChange)
  useEffect(() => {
    closeRef.current = onOpenChange
  }, [onOpenChange])
  useEffect(() => {
    if (logout.failureCount > 0) closeRef.current(false)
  }, [closeRef, logout.failureCount])
  return (
    <Dialog
      size="sm"
      open={open}
      onOpenChange={onOpenChange}
      title={t('sso.logoutTitle')}
      description={t('sso.logoutDescription')}
      preventClose={logout.isPending}
      initialFocusRef={cancel}
      returnFocusRef={returnFocusRef}
      footer={
        <>
          <Button
            ref={cancel}
            variant="outline"
            disabled={logout.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('sso.cancel')}
          </Button>
          <Button
            disabled={logout.isPending}
            onClick={() =>
              logout.isError ? logout.recheck() : logout.mutate()
            }
          >
            {t('sso.logoutAction')}
          </Button>
        </>
      }
    >
      {logout.isPending ? <p role="status">{t('sso.loggingOut')}</p> : null}
    </Dialog>
  )
}
