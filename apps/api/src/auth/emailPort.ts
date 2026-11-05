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
