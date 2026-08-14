import type { User } from '@common/types/domain'

const CREATED_AT = '2026-01-01T00:00:00.000Z'
export const DEMO_USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
export const DEMO_ADMIN_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1002'

export const demoUsers: User[] = [
  {
    id: DEMO_USER_ID,
    name: '데모 학습자',
    role: 'USER',
    targetLevel: 'N2',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  },
  {
    id: DEMO_ADMIN_ID,
    name: '데모 관리자',
    role: 'ADMIN',
    targetLevel: 'N1',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  }
]
