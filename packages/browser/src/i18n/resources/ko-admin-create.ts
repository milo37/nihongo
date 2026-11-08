import { koAdminFormResources } from './ko-admin-form'

/** Admin question create screen; kept out of the shared Korean chunk. */
export const koAdminCreateResources = {
  page: koAdminFormResources.createPage,
  eyebrow: 'CREATE DRAFT',
  title: '새 문제 초안 만들기',
  description:
    '생성 결과는 항상 새 초안 버전입니다. 공개 상태를 폼에서 직접 지정할 수 없습니다.',
  submit: '초안 만들기',
  error: '문제를 만들지 못했습니다.'
} as const
