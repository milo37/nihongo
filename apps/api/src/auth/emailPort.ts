import type { ApiEnvironment } from '../config/env.js'

export type AuthEmailPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'

export interface AuthEmailMessage {
  from: string
  purpose: AuthEmailPurpose
  recipient: string
  url: string
}

export interface AuthEmailPort {
  send: (message: AuthEmailMessage) => Promise<void>
}

export class InMemoryAuthEmailPort implements AuthEmailPort {
  readonly messages: AuthEmailMessage[] = []

  send = async (message: AuthEmailMessage): Promise<void> => {
    this.messages.push(structuredClone(message))
  }
}

class WebhookAuthEmailPort implements AuthEmailPort {
  constructor(
    private readonly endpoint: string,
    private readonly secret: string
  ) {}

  send = async (message: AuthEmailMessage): Promise<void> => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.secret}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(2_250)
        })
        const isSuccessful = response.ok
        await response.body?.cancel().catch(() => undefined)
        if (isSuccessful) return
      } catch {
        // Retry once below without logging any recipient or link data.
      }
      if (attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    throw new Error('Auth email delivery failed.')
  }
}

export const createAuthEmailPort = (
  environment: ApiEnvironment
): AuthEmailPort => {
  if (environment.AUTH_EMAIL_DELIVERY_MODE === 'test-sink') {
    return new InMemoryAuthEmailPort()
  }

  if (
    !environment.AUTH_EMAIL_WEBHOOK_URL ||
    !environment.AUTH_EMAIL_WEBHOOK_SECRET
  ) {
    throw new Error('Auth email webhook is not configured.')
  }

  return new WebhookAuthEmailPort(
    environment.AUTH_EMAIL_WEBHOOK_URL,
    environment.AUTH_EMAIL_WEBHOOK_SECRET
  )
}
