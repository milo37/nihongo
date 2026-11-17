import { safePut } from '@nihongo/browser/api/http'
import type { UpdateNicknameBody } from '@nihongo/contracts/auth/update-nickname'
import { updateNicknameResponseSchema } from '@api/auth/updateNickname/schema'
const request = safePut(updateNicknameResponseSchema)
// #1096: the server trims and checks the same 2~12 rule (400 otherwise).
export const updateNickname = (nickname: string) =>
  request('/v1/me/nickname', { nickname } satisfies UpdateNicknameBody)
