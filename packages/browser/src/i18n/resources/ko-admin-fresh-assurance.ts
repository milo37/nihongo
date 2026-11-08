/** Admin fresh sign-in assurance; kept out of the shared Korean chunk. */
export const koAdminFreshAssuranceResources = {
  title: '관리자 본인 확인',
  description:
    '{{reason}} 연결한 계정으로 본인 확인 후 작업 버튼을 다시 눌러야 합니다.',
  cancel: '취소',
  checkingSession: '로그인 상태 확인 중…',
  retrySession: '로그인 상태 다시 확인',
  checking: '확인 중…',
  confirm: '본인 확인',
  complete:
    '로그인 상태를 다시 확인했습니다. 원래 작업은 자동 실행되지 않았습니다. 내용을 확인한 뒤 직접 다시 실행해 주세요.',
  recovered:
    '현재 관리자 세션을 확인했습니다. 연결한 계정으로 본인 확인을 재시도해 주세요.',
  recoveryFailed:
    '로그인 상태를 확인하지 못했습니다. 로컬 작업은 유지됩니다. 로그인 상태 확인을 다시 시도해 주세요.',
  failed: '본인 확인을 완료하지 못했습니다.',
  reasons: {
    BATCH_REVIEW: '일괄 검수 요청은 민감한 관리자 작업입니다.',
    EXPORT: '문제 내보내기에는 민감한 정답·해설이 포함됩니다.',
    IMPORT_APPLY:
      '가져오기 적용은 여러 문제를 만드는 민감한 관리자 작업입니다.',
    QUESTION_APPROVE: '승인 작업은 민감한 관리자 작업입니다.',
    QUESTION_ARCHIVE: '문제 보관 작업은 민감한 관리자 작업입니다.',
    QUESTION_PUBLISH: '공개 작업은 민감한 관리자 작업입니다.',
    QUESTION_RETIRE: '공개 중단 작업은 민감한 관리자 작업입니다.',
    QUESTION_WITHDRAW: '승인 철회 작업은 민감한 관리자 작업입니다.',
    REPORT_RESOLUTION: '신고 최종 처리는 민감한 관리자 작업입니다.'
  }
} as const
