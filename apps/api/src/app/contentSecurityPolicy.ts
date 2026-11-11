import type { secureHeaders } from 'hono/secure-headers'
import type { ApiEnvironment } from '../config/env.js'

type SecureHeadersOptions = NonNullable<Parameters<typeof secureHeaders>[0]>
type ContentSecurityPolicy = NonNullable<
  SecureHeadersOptions['contentSecurityPolicy']
>

/**
 * Content-Security-Policy for the learner and admin pages and the API
 * (JLP-788). Both built apps load only their own script and CSS files: no
 * inline script or style element, no web font, no outside origin. Google and
 * Apple sign-in fetch the provider URL from this origin and then navigate the
 * whole page there, which the policy does not restrict.
 */
const createContentSecurityPolicy = (): ContentSecurityPolicy => ({
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'"],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"]
})

export type ContentSecurityPolicyMode = 'report-only' | 'enforce'

/**
 * CSP_MODE switches the policy between reporting and blocking. Unset, every
 * environment enforces; report-only (violations show in the browser console)
 * only when CSP_MODE says so.
 */
export const resolveContentSecurityPolicyMode = (
  environment: Pick<ApiEnvironment, 'CSP_MODE'>
): ContentSecurityPolicyMode => environment.CSP_MODE ?? 'enforce'

export const contentSecurityPolicyHeaders = (
  mode: ContentSecurityPolicyMode
): SecureHeadersOptions =>
  mode === 'enforce'
    ? { contentSecurityPolicy: createContentSecurityPolicy() }
    : { contentSecurityPolicyReportOnly: createContentSecurityPolicy() }
