import { useAccountRestoreNotice } from '@app/login/hooks/useAccountRestoreNotice'

/** Renders nothing; announces a restored or kept account once (JLP-845). */
export const AccountRestoreNotice = (): null => {
  useAccountRestoreNotice()
  return null
}
