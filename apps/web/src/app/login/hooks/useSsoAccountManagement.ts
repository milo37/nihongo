import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import {
  accountFreshOutcomeSchema,
  accountLinkOutcomeSchema
} from '@nihongo/contracts/auth/sso-account-management'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import {
  AccountFlowError,
  accountMutationRequest
} from '@app/login/accountFlowErrors'
import { commitCanonicalAuth } from '@app/login/authSession'
import { accountQueries } from '@app/login/queries/accountQueries'
import { accountMutations } from '@app/login/queries/accountMutations'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { isMockApiMode } from '@libs/apiMode'
import { socialAuthNavigation } from '@libs/socialAuthNavigation'

export type AccountDialog =
  | { kind: 'fresh' | 'delete' }
  | { kind: 'unlink'; provider: SsoProviderId }
type ReturnEvent = { kind: 'fresh' | 'link'; outcome: string } | null
const readReturn = (search: string): ReturnEvent => {
  const params = new URLSearchParams(search)
  if (!params.has('ssoAccountFresh') && !params.has('ssoAccountLink'))
    return null
  const kind = params.has('ssoAccountFresh') ? 'fresh' : 'link'
  const key = kind === 'fresh' ? 'ssoAccountFresh' : 'ssoAccountLink'
  const parsed = (
    kind === 'fresh' ? accountFreshOutcomeSchema : accountLinkOutcomeSchema
  ).safeParse(params.get(key))
  return {
    kind,
    outcome:
      params.getAll(key).length === 1 &&
      !(params.has('ssoAccountFresh') && params.has('ssoAccountLink')) &&
      parsed.success
        ? parsed.data
        : 'INVALID_CALLBACK'
  }
}
export const useSsoAccountManagement = () => {
  const { isReady, user } = useAuth()
  const client = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [dialog, setDialog] = useState<AccountDialog | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const navigating = useRef(false)
  const [returnEvent, setReturnEvent] = useState(() =>
    readReturn(location.search)
  )
  const [returnKey, setReturnKey] = useState(location.key)
  const incoming = readReturn(location.search)
  const hasIncoming = incoming !== null
  if (incoming && returnKey !== location.key) {
    setReturnKey(location.key)
    setReturnEvent(incoming)
  }
  const capabilities = useQuery({
    ...accountQueries.capabilities(user?.id ?? ''),
    enabled: isReady && user !== null
  })
  const endSession = async (path: string, state: unknown = null) => {
    const result = await commitCanonicalAuth(client, null, {
      forceClear: true,
      forcePracticeReset: true
    })
    if (result.applied) await navigate(path, { replace: true, state })
  }
  useEffect(() => {
    if (!hasIncoming) return
    const search = new URLSearchParams(location.search)
    search.delete('ssoAccountFresh')
    search.delete('ssoAccountLink')
    void navigate(
      { pathname: location.pathname, search: search.toString(), hash: '' },
      { replace: true, state: null }
    )
    void client.invalidateQueries({ queryKey: accountQueries.allKey() })
  }, [client, location.pathname, location.search, navigate, hasIncoming])
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
      setDialog({ kind: 'fresh' })
      setFeedback('reauthTitle')
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
          setReturnEvent({
            kind: input.purpose === 'ACCOUNT_FRESH' ? 'fresh' : 'link',
            outcome:
              input.purpose === 'ACCOUNT_FRESH' ? 'REAUTHENTICATED' : 'LINKED'
          })
          setDialog(null)
          setFeedback(null)
          await capabilities.refetch()
        } catch (error: unknown) {
          fail(error instanceof Error ? error : new AccountFlowError(error))
        }
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
    onError: fail
  })
  const unlink = useMutation({
    ...accountMutations.unlink(),
    onSuccess: async () => {
      setDialog(null)
      setFeedback('unlinked')
      await endSession('/login')
    },
    onError: fail
  })
  const deletion = useMutation({
    ...accountMutations.delete(),
    onSuccess: async () => {
      setDialog(null)
      await endSession('/account/data', { deletionRequested: true })
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
  const recheck = async () => {
    try {
      await client.fetchQuery(accountQueries.deletion())
      await endSession('/account/data', { deletionRequested: true })
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
  const request = (action: AccountDialog) => {
    if (busy || uncertain || !capabilities.data || capabilities.isError) return
    const caps = capabilities.data
    if (action.kind === 'delete' && !caps.canDelete) return
    if (
      action.kind === 'unlink' &&
      !caps.providers.some((p) => p.provider === action.provider && p.canUnlink)
    )
      return
    setFeedback(null)
    setDialog(
      (action.kind === 'delete' ||
        (action.kind === 'unlink' && caps.unlinkRequiresFresh)) &&
        !caps.freshVerified
        ? { kind: 'fresh' }
        : action
    )
  }
  const begin = (
    purpose: 'ACCOUNT_FRESH' | 'ACCOUNT_LINK',
    provider: SsoProviderId
  ) => {
    if (busy || uncertain || !capabilities.data || capabilities.isError) return
    const caps = capabilities.data
    if (purpose === 'ACCOUNT_LINK' && !caps.freshVerified) {
      setDialog({ kind: 'fresh' })
      return
    }
    if (
      purpose === 'ACCOUNT_LINK'
        ? !caps.linkableProviders.includes(provider)
        : !caps.providers.some(
            (p) => p.provider === provider && p.reauthAvailable
          )
    )
      return
    setReturnEvent(null)
    setFeedback(null)
    start.mutate({ purpose, provider, callbackURL: '/login' })
  }
  return {
    isReady,
    user,
    capabilities,
    dialog,
    setDialog,
    feedback,
    uncertain,
    busy,
    returnEvent,
    start,
    unlink,
    deletion,
    request,
    begin,
    recheck
  }
}
