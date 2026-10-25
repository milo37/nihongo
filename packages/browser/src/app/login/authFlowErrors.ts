import { isApiError } from '../../api/config'

export class AuthFlowError extends Error {
  readonly unavailable: boolean

  constructor(error: unknown) {
    super('The authentication action could not be confirmed.')
    this.name = 'AuthFlowError'
    this.unavailable =
      isApiError(error) &&
      error.status === 503 &&
      error.code === 'SSO_UNAVAILABLE'
  }
}
