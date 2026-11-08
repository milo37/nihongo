/** Shared admin controls; kept out of the shared Korean chunk. */
export const koAdminCommonResources = {
  breadcrumbLabel: '현재 위치',
  menuLabel: '관리자 메뉴',
  wideScreenRecommended:
    '이 작업은 넓은 화면에서 하는 것을 권장합니다. 휴대폰에서도 계속할 수 있습니다.',
  questions: '문제 관리',
  questionDetail: '문제 상세',
  newQuestion: '새 문제',
  import: '가져오기',
  auditLog: '감사 기록',
  reports: '신고 큐',
  reportDetail: '신고 상세',
  none: '없음',
  unassigned: '미할당',
  open: '열기',
  question: '문제',
  version: '버전',
  status: '상태',
  reason: '사유',
  reporter: '신고자',
  assignee: '담당자',
  actor: '행위자',
  createdAt: '생성일',
  updatedAt: '수정일',
  details: '상세',
  rowVersion: 'rowVersion',
  selectedFile: '선택: {{fileName}}',
  retryAfter: '{{message}} {{seconds}}초 뒤 다시 시도해 주세요.',
  retryAfterMinutes: '{{message}} {{minutes}}분 뒤 다시 시도해 주세요.',
  pausedTitle: '오프라인에서 최신 상태를 확인할 수 없습니다',
  pausedDescription:
    '연결이 복구되면 다시 확인해 주세요. 최신 상태를 확인할 때까지 관리자 변경 작업을 사용할 수 없습니다.',
  cachedPausedDescription:
    '오프라인이라 최신 상태를 확인하지 못했습니다. 현재 자료는 유지되며 관리자 변경 작업은 잠겼습니다.',
  retry: '최신 상태 다시 확인'
} as const
