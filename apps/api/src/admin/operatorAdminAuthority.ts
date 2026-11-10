import type { AdminCommandAuthority } from './adminQuestionCommandModel.js'

/**
 * Authority for a server operator command that runs admin content commands
 * without a login (JLP-828). Only objects made here pass as operator
 * authority: the token is empty, so no Session ever matches it, and the
 * operation begin/finish check the actor is still an ACTIVE ADMIN instead of
 * a Session and its SSO fresh proof. Only operator commands may import this
 * module; HTTP routes and middleware never do (operatorAdminAuthority.test).
 */
const operatorAuthorities = new WeakMap<AdminCommandAuthority, string>()

export const createOperatorAdminAuthority = (input: {
  readonly actorId: string
  readonly requestId: string
}): AdminCommandAuthority => {
  const authority: AdminCommandAuthority = Object.freeze({
    actorId: input.actorId,
    rawSessionToken: '',
    requestId: input.requestId
  })
  operatorAuthorities.set(authority, input.actorId)
  return authority
}

/** The operator actor id, or null for an ordinary Session authority. */
export const operatorActorOf = (
  authority: AdminCommandAuthority
): string | null => operatorAuthorities.get(authority) ?? null
