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
    description: '신고 내용은 관리자만 확인해요.',
    details: '설명',
    descriptionRequired: '신고 설명을 입력해 주세요.',
    cancel: '취소',
    submit: '신고 접수',
    sent: '신고를 보냈어요.',
    error: '문제 신고를 접수하지 못했어요.',
    offline: '오프라인이에요. 작성한 설명은 그대로 남아 있어요.',
    appErrorTrigger: '앱 오류 제보',
    errorScreenTrigger: '오류 제보',
    appErrorTitle: '앱 오류 제보',
    appErrorDescription:
      '어떤 화면에서 무엇을 하다가 문제가 생겼는지 적어 주세요. 제보 내용은 관리자만 확인해요.',
    appErrorSent: '오류 제보를 보냈어요.',
    appErrorError: '앱 오류 제보를 접수하지 못했어요.'
  }
} as const
