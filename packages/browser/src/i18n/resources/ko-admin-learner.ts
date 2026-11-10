/** Admin copy the learner app also shows: report dialogs, API errors, re-verification. */
import { koAdminCommonResources } from './ko-admin-common'
import { koAdminErrorsResources } from './ko-admin-errors'
import { koAdminReauthResources } from './ko-admin-reauth'

export const koAdminLearnerResources = {
  name: '관리자',
  reauth: koAdminReauthResources,
  common: koAdminCommonResources,
  errors: koAdminErrorsResources,
  questionReportDialog: {
    trigger: '문제 신고',
    title: '문제 신고',
    description: '보내 주신 내용은 운영자만 봐요.',
    details: '어디가 이상한가요?',
    descriptionRequired: '내용을 적어 주세요.',
    cancel: '취소',
    submit: '보내기',
    sent: '신고를 보냈어요. 고마워요!',
    error: '보내지 못했어요. 다시 시도해 주세요.',
    offline: '인터넷 연결이 끊겼어요. 쓴 내용은 그대로 있어요.',
    appErrorTrigger: '오류 알리기',
    errorScreenTrigger: '오류 알리기',
    appErrorTitle: '오류 알리기',
    appErrorDescription:
      '어느 화면에서 무엇을 하다가 문제가 생겼는지 적어 주세요. 운영자만 봐요.',
    appErrorSent: '알려 주셔서 고마워요. 확인할게요.',
    appErrorError: '보내지 못했어요. 다시 시도해 주세요.'
  }
} as const
