/** Admin audit log screen; kept out of the shared Korean chunk. */
export const koAdminAuditResources = {
  eyebrow: 'ADMIN AUDIT',
  title: '관리자 감사 기록',
  description: '민감한 문제 본문 대신 허용된 상태·digest 증거만 표시합니다.',
  cachedError:
    '최신 감사 기록을 확인하지 못했습니다. 현재 기록은 그대로 유지됩니다.',
  retry: '감사 기록 다시 확인',
  loading: '감사 기록을 불러오는 중입니다…',
  error: '감사 기록을 불러오지 못했습니다.',
  emptyTitle: '감사 기록이 없습니다',
  emptyDescription: '아직 기록된 관리자 명령이 없습니다.',
  stateChange: '상태 변경',
  changedFields: '변경 필드',
  requestEnvironment: '요청 {{requestId}} · 환경 {{environment}}',
  moreLoading: '이전 감사 기록 불러오는 중…',
  more: '이전 감사 기록 더 보기'
} as const
