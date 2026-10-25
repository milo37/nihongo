import { mutationOptions } from '@tanstack/react-query'
import type {
  AccountSsoRequest,
  DeleteSsoAccountRequest,
  UnlinkSsoAccountRequest
} from '@nihongo/contracts/auth/sso-account-management'
import { startAccountSso } from '@api/auth/startAccountSso'
import { unlinkSsoAccount } from '@api/auth/unlinkSsoAccount'
import { deleteSsoAccount } from '@api/auth/deleteSsoAccount'
import { accountMutationRequest } from '@app/login/accountFlowErrors'
import { accountQueries } from '@app/login/queries/accountQueries'
export const accountMutations = {
  start: () =>
    mutationOptions({
      mutationKey: [...accountQueries.allKey(), 'start'],
      retry: false,
      networkMode: 'always',
      mutationFn: (input: AccountSsoRequest) =>
        accountMutationRequest(() => startAccountSso(input))
    }),
  unlink: () =>
    mutationOptions({
      mutationKey: [...accountQueries.allKey(), 'unlink'],
      retry: false,
      networkMode: 'always',
      mutationFn: (input: UnlinkSsoAccountRequest) =>
        accountMutationRequest(() => unlinkSsoAccount(input))
    }),
  delete: () =>
    mutationOptions({
      mutationKey: [...accountQueries.allKey(), 'delete'],
      retry: false,
      networkMode: 'always',
      mutationFn: (input: DeleteSsoAccountRequest) =>
        accountMutationRequest(() => deleteSsoAccount(input))
    })
}
