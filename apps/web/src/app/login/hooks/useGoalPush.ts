import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getPushConfig } from '@api/push'
import {
  askPushPermission,
  readDevicePush,
  turnOffDevicePush,
  turnOnDevicePush
} from '@common/libs/devicePush'
import type { DevicePushState } from '@common/libs/devicePush'

/**
 * #1046 the switch on the study goal page. Turning it on asks the browser at
 * once (the tap is what allows the prompt); [저장]/[시작하기] then saves it
 * with the goal. Leaving without saving changes nothing.
 */
export const useGoalPush = () => {
  const { i18n } = useTranslation()
  const locale = i18n.language === 'ja' ? 'ja' : 'ko'
  const config = useQuery({
    queryKey: ['push', 'config'] as const,
    queryFn: getPushConfig,
    staleTime: Infinity,
    retry: false,
    // A failed read only hides the switch; there is nothing to tell.
    meta: { localErrorUi: true }
  })
  const [device, setDevice] = useState<DevicePushState | null>(null)
  const [wanted, setWanted] = useState<boolean | null>(null)
  // Read again on coming back to the tab: the member may have allowed
  // notifications in the browser settings meanwhile.
  useEffect(() => {
    let live = true
    const read = (): void => {
      void readDevicePush().then((next) => {
        if (live) setDevice(next)
      })
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') read()
    }
    read()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  // A server with push off (no key) or a failed read shows no switch.
  const publicKey = config.data?.publicKey ?? null
  const state: DevicePushState =
    publicKey === null || device === null ? 'hidden' : device
  const open = state === 'on' || state === 'off'
  const checked = open && (wanted ?? state === 'on')
  const toggle = async (next: boolean): Promise<void> => {
    setWanted(next)
    if (!next || Notification.permission === 'granted') return
    const answer = await askPushPermission()
    if (answer === 'granted') return
    setWanted(false)
    // Closing the prompt leaves it askable; only a refusal blocks the switch.
    if (answer === 'denied') setDevice('denied')
  }
  /** Runs after the goal is saved; a failed subscription throws. */
  const apply = async (): Promise<void> => {
    if (!open || publicKey === null) return
    if (checked) await turnOnDevicePush(publicKey, locale)
    else if (state === 'on') await turnOffDevicePush()
  }
  return { state, checked, toggle, apply }
}
