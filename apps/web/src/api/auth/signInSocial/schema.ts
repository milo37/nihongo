import {
  signInSocialRequestSchema as sharedRequestSchema,
  signInSocialResponseSchema as sharedResponseSchema
} from '@nihongo/contracts/auth/sign-in-social'

export const signInSocialRequestSchema = sharedRequestSchema
export const signInSocialResponseSchema = sharedResponseSchema
export type {
  SignInSocialRequest,
  SignInSocialResponse
} from '@nihongo/contracts/auth/sign-in-social'
