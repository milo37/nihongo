import type { User } from '@common/types/domain'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

export const demoUsers: User[] = [
  {
    id: 'demo-user',
    name: '데모 학습자',
    role: 'USER',
    targetLevel: 'N2',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  },
  {
    id: 'demo-admin',
    name: '데모 관리자',
    role: 'ADMIN',
    targetLevel: 'N1',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  }
]
