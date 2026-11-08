import { useRef } from 'react'
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
            {t(logout.isError ? 'sso.recheck' : 'sso.logoutAction')}
          </Button>
        </>
      }
    >
      {logout.isPending ? <p role="status">{t('sso.loggingOut')}</p> : null}
      {logout.isError ? <p role="alert">{t('sso.logoutUnknown')}</p> : null}
    </Dialog>
  )
}
