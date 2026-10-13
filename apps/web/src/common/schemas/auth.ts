import { z } from 'zod'
import { LEVELS } from '@common/types/domain'

export const emailSignInSchema = z
  .object({
    email: z.email('올바른 이메일 주소를 입력해 주세요.'),
    password: z.string().min(12).max(128)
  })
  .strict()

export const emailSignUpSchema = z
  .object({
    email: z.email('올바른 이메일 주소를 입력해 주세요.'),
    name: z.string().trim().min(1, '이름을 입력해 주세요.').max(80),
    password: z.string().min(12, '비밀번호는 12자 이상이어야 합니다.').max(128),
    targetLevel: z.enum(LEVELS)
  })
  .strict()

export const passwordResetRequestSchema = z
  .object({
    email: z.email('올바른 이메일 주소를 입력해 주세요.')
  })
  .strict()

export const passwordResetConfirmSchema = z
  .object({
    newPassword: z
      .string()
      .min(12, '새 비밀번호는 12자 이상이어야 합니다.')
      .max(128),
    token: z.string().min(1)
  })
  .strict()
