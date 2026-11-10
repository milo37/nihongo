import { useGuestResultCarry } from '@app/login/hooks/useGuestResultCarry'

/** Renders nothing; moves the guest's last result once after sign-in. */
export const GuestResultCarry = (): null => {
  useGuestResultCarry()
  return null
}
