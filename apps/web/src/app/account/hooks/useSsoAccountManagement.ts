import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import type { z } from 'zod'
import {
  accountFreshOutcomeSchema,
  accountReauthActionSchema
} from '@nihongo/contracts/auth/sso-account-management'
import type { AccountReauthAction } from '@nihongo/contracts/auth/sso-account-management'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'
import {
  AccountFlowError,
  accountMutationRequest
} from '@app/account/accountFlowErrors'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { accountQueries } from '@app/account/queries/accountQueries'
import { accountMutations } from '@app/account/queries/accountMutations'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isMockApiMode } from '@nihongo/browser/libs/apiMode'
import { socialAuthNavigation } from '@nihongo/browser/libs/socialAuthNavigation'

type AccountFreshOutcome = z.output<typeof accountFreshOutcomeSchema>
export type AccountIntent =
  | { kind: 'delete' }
  | { kind: 'unlink'; provider: SsoProviderId }
export type AccountDialog = AccountIntent & { step: 'verify' | 'confirm' }
export type AccountFeedback =
  | 'actionFailed'
  | 'lastAdminDeletionBlocked'
  | 'lastMethodTitle'
  | 'openAdminWork'
  | 'reauthCancelled'
  | 'reauthFailed'
  | 'reauthInvalid'
  | 'wrongAccount'

/** The `auth` text key for each account feedback. */
export const ACCOUNT_FEEDBACK_KEY: Record<AccountFeedback, string> = {
  actionFailed: 'sso.actionFailed',
  lastAdminDeletionBlocked: 'sso.lastAdminDeletionBlocked',
  lastMethodTitle: 'sso.lastMethodTitle',
  openAdminWork: 'sso.openAdminWork',
  reauthCancelled: 'reauth.account.cancelled',
  reauthFailed: 'reauth.account.failed',
  reauthInvalid: 'reauth.account.invalid',
  wrongAccount: 'reauth.account.wrongAccount'
}

export const ACCOUNT_FRESH_PARAM = 'ssoAccountFresh'
export const ACCOUNT_REAUTH_PARAM = 'reauth'

const readFreshReturn = (search: string): AccountFreshOutcome | null => {
  const values = new URLSearchParams(search).getAll(ACCOUNT_FRESH_PARAM)
  if (values.length === 0) return null
  const parsed = accountFreshOutcomeSchema.safeParse(values[0])
  return values.length === 1 && parsed.success
    ? parsed.data
    : 'INVALID_CALLBACK'
}

const toAction = (intent: AccountIntent): AccountReauthAction =>
  intent.kind === 'delete' ? 'delete' : `unlink:${intent.provider}`

const readReturnIntent = (search: string): AccountIntent | null => {
  const values = new URLSearchParams(search).getAll(ACCOUNT_REAUTH_PARAM)
  const parsed = accountReauthActionSchema.safeParse(
    values.length === 1 ? values[0] : null
  )
  if (!parsed.success) return null
  if (parsed.data === 'delete') return { kind: 'delete' }
  const [, provider] = parsed.data.split(':') as [string, SsoProviderId]
  return { kind: 'unlink', provider }
}

const returnFeedback: Record<
  Exclude<AccountFreshOutcome, 'REAUTHENTICATED'>,
  AccountFeedback
> = {
  CANCELLED: 'reauthCancelled',
  FAILED: 'reauthFailed',
  INVALID_CALLBACK: 'reauthInvalid'
}

// Runs sign-in method unlink and account deletion as one dialog: ① verify
// with Google in the same tab, then ② confirm. Verification returns to
// /login?reauth=<action> (the account SSO return contract) and /login
// forwards both parameters here, where the same dialog opens again.
export const useSsoAccountManagement = () => {
  const { isReady, user } = useAuth()
  const client = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [dialog, setDialog] = useState<AccountDialog | null>(null)
  const [feedback, setFeedback] = useState<AccountFeedback | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  // A verified return reopens its dialog once capabilities have reloaded.
  const [resumeIntent, setResumeIntent] = useState<AccountIntent | null>(null)
  const [returned, setReturned] = useState(false)
  const navigating = useRef(false)
  const userId = user?.id ?? null
  const incoming = readFreshReturn(location.search)
  const incomingIntent = readReturnIntent(location.search)
  const capabilities = useQuery({
    ...accountQueries.capabilities(userId ?? ''),
    enabled: isReady && userId !== null
  })
  const caps = capabilities.isError ? undefined : capabilities.data
  const endSession = async (path: string, state: unknown = null) => {
    const result = await commitCanonicalAuth(client, null, {
      forceClear: true,
      forcePracticeReset: true
    })
    if (result.applied) await navigate(path, { replace: true, state })
  }
  const [handledReturnKey, setHandledReturnKey] = useState<string | null>(null)
  if (
    incoming !== null &&
    userId !== null &&
    handledReturnKey !== location.key
  ) {
    setHandledReturnKey(location.key)
    if (incoming === 'REAUTHENTICATED') setResumeIntent(incomingIntent)
    else {
      setFeedback(returnFeedback[incoming])
      if (incomingIntent) setDialog({ ...incomingIntent, step: 'verify' })
    }
  }
  useEffect(() => {
    if (incoming === null || userId === null) return
    const search = new URLSearchParams(location.search)
    search.delete(ACCOUNT_FRESH_PARAM)
    search.delete(ACCOUNT_REAUTH_PARAM)
    void navigate(
      { pathname: location.pathname, search: search.toString(), hash: '' },
      { replace: true, state: null }
    )
    void client.invalidateQueries({ queryKey: accountQueries.allKey() })
  }, [client, incoming, location.pathname, location.search, navigate, userId])
  if (resumeIntent && caps && !capabilities.isFetching) {
    setResumeIntent(null)
    // The server decides: only a verification it recorded opens step ②.
    setReturned(caps.freshVerified)
    if (!caps.freshVerified) setFeedback('reauthFailed')
    setDialog({
      ...resumeIntent,
      step: caps.freshVerified ? 'confirm' : 'verify'
    })
  }
  useEffect(() => {
    if (
      capabilities.error instanceof AccountFlowError &&
      capabilities.error.authenticationRequired
    )
      void commitCanonicalAuth(client, null, {
        forceClear: true,
        forcePracticeReset: true
      })
  }, [capabilities.error, client])
  const fail = (error: Error) => {
    if (isAuthTransitionSupersededError(error)) return
    if (error instanceof AccountFlowError && error.authenticationRequired) {
      void endSession('/login')
      return
    }
    if (
      error instanceof AccountFlowError &&
      error.code === 'SSO_FRESH_REQUIRED'
    ) {
      setReturned(false)
      setDialog((current) => (current ? { ...current, step: 'verify' } : null))
      void client.invalidateQueries({ queryKey: accountQueries.allKey() })
      return
    }
    if (
      error instanceof AccountFlowError &&
      error.code &&
      error.code !== 'SSO_ACCOUNT_OPERATION_UNAVAILABLE'
    ) {
      setFeedback(
        error.code === 'SSO_ACCOUNT_NOT_LINKED'
          ? 'wrongAccount'
          : error.code === 'SSO_LAST_SIGN_IN_METHOD'
            ? 'lastMethodTitle'
            : error.code === 'SSO_ACCOUNT_DELETION_BLOCKED'
              ? 'openAdminWork'
              : error.code === 'SSO_LAST_ADMIN_DELETION_BLOCKED'
                ? 'lastAdminDeletionBlocked'
                : 'actionFailed'
      )
      void capabilities.refetch()
      return
    }
    // An unconfirmed mutation is never repeated by this recovery control.
    setUncertain(true)
    setFeedback('actionFailed')
  }
  const start = useMutation({
    ...accountMutations.start(),
    onSuccess: async (response, input) => {
      if (!__NIHONGO_PRODUCTION_BUILD__ && isMockApiMode) {
        const { completeMockAccountSso } = await import(
          '@api/auth/completeMockAccountSso'
        )
        try {
          await accountMutationRequest(() => completeMockAccountSso(input))
        } catch (error: unknown) {
          fail(error instanceof Error ? error : new AccountFlowError(error))
          return
        }
        // MSW has no Google round trip: come back the way the server would.
        const back = new URL(
          input.callbackURL ?? '/login',
          window.location.origin
        )
        back.searchParams.set(ACCOUNT_FRESH_PARAM, 'REAUTHENTICATED')
        await navigate(back.pathname + back.search, { replace: true })
        return
      }
      if (navigating.current) return
      navigating.current = true
      setRedirecting(true)
      try {
        socialAuthNavigation.assign(response.url)
      } catch {
        navigating.current = false
        setRedirecting(false)
        setFeedback('actionFailed')
      }
    },
    onError: (error) => {
      // Starting verification changes no account state, so a failure here is
      // never "uncertain" and the same button stays available.
      if (
        error instanceof AccountFlowError &&
        error.code === undefined &&
        !error.authenticationRequired
      ) {
        setFeedback('actionFailed')
        return
      }
      fail(error)
    }
  })
  const unlink = useMutation({
    ...accountMutations.unlink(),
    onSuccess: async () => {
      setDialog(null)
      await endSession('/login', { accountUnlinked: true })
    },
    onError: fail
  })
  const deletion = useMutation({
    ...accountMutations.delete(),
    onSuccess: async () => {
      setDialog(null)
      await endSession('/login', { deletionRequested: true })
    },
    onError: fail
  })
  const resetStart = start.reset
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      navigating.current = false
      setRedirecting(false)
      resetStart()
      void client.invalidateQueries({ queryKey: accountQueries.allKey() })
    }
    window.addEventListener('pageshow', restore)
    return () => window.removeEventListener('pageshow', restore)
  }, [client, resetStart])
  const busy =
    start.isPending || unlink.isPending || deletion.isPending || redirecting
  const canVerify =
    caps?.providers.some((p) => p.provider === 'google' && p.reauthAvailable) ??
    false
  const recheck = async () => {
    try {
      await client.fetchQuery(accountQueries.deletion())
      await endSession('/login', { deletionRequested: true })
    } catch (error: unknown) {
      if (
        !(error instanceof AccountFlowError) ||
        error.code !== 'SSO_DELETION_RECEIPT_UNAVAILABLE'
      )
        return
      const current = await capabilities.refetch()
      if (current.isSuccess) {
        setUncertain(false)
        setFeedback('actionFailed')
      }
    }
  }
  const request = (intent: AccountIntent) => {
    if (busy || uncertain || !caps) return
    if (intent.kind === 'delete' && !caps.canDelete) return
    if (
      intent.kind === 'unlink' &&
      !caps.providers.some((p) => p.provider === intent.provider && p.canUnlink)
    )
      return
    const needsFresh =
      (intent.kind === 'delete' || caps.unlinkRequiresFresh) &&
      !caps.freshVerified
    setFeedback(null)
    setReturned(false)
    setDialog({ ...intent, step: needsFresh ? 'verify' : 'confirm' })
  }
  const verify = () => {
    if (busy || uncertain || !dialog || !userId || !canVerify) return
    const back = new URLSearchParams({
      [ACCOUNT_REAUTH_PARAM]: toAction(dialog)
    })
    setFeedback(null)
    start.mutate({
      purpose: 'ACCOUNT_FRESH',
      provider: 'google',
      callbackURL: '/login?' + back.toString()
    })
  }
  const confirm = () => {
    if (busy || uncertain || dialog?.step !== 'confirm') return
    if (dialog.kind === 'unlink') unlink.mutate({ provider: dialog.provider })
    else deletion.mutate({})
  }
  const closeDialog = () => {
    if (busy) return
    setDialog(null)
    setReturned(false)
  }
  return {
    isReady,
    user,
    capabilities,
    caps,
    canVerify,
    dialog,
    returned,
    closeDialog,
    feedback,
    uncertain,
    busy,
    start,
    request,
    verify,
    confirm,
    recheck
  }
}

export type SsoAccountFlow = ReturnType<typeof useSsoAccountManagement>
