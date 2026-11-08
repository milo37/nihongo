import { koAdminFormResources } from './ko-admin-form'

/** Admin question create screen; kept out of the shared Korean chunk. */
export const koAdminCreateResources = {
  page: koAdminFormResources.createPage,
  title: '새 문제 초안 만들기',
  description:
    '새 문제는 초안으로 저장돼요. 검토·승인을 거쳐야 학습자에게 공개돼요.',
  submit: '초안 만들기',
  error: '문제를 만들지 못했습니다.'
} as const
