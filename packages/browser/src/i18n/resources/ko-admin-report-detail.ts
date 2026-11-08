/** Admin question report detail screen; kept out of the shared Korean chunk. */
export const koAdminReportDetailResources = {
  advancedFilters: '상세 조건',
  dateHint: '시간대가 포함된 ISO 시각 (예: 2026-10-01T00:00:00Z)',
  applyFilters: '필터 적용',
  previous: '이전 목록',
  next: '다음 목록',
  first: '처음 목록으로',
  total: '전체 {{count}}건',
  rowInfo: '신고 정보',
  back: '신고 목록으로',
  reasonHint: '최대 1,000자 (유니코드 문자 기준)',
  restored:
    '같은 관리자 계정과 신고 버전을 확인해 처리 사유 초안을 복구했습니다. 내용을 확인한 뒤 직접 처리해 주세요.',
  storageFailed:
    '초안을 보관하지 못해 본인 확인 화면으로 이동하지 않았습니다. 입력을 복사해 보관하거나 다시 시도해 주세요.',
  discard: '초안 버리기',
  fresh: 'Google로 관리자 본인 확인',
  leaveTitle: '작성 중인 처리 사유가 있습니다',
  stay: '계속 작성',
  leave: '버리고 이동',
  pending: '작업이 끝날 때까지 기다려 주세요.',
  listDescription: '신고 사유와 처리 상태를 확인하고 상세에서 처리하세요.',
  title: '문제 신고 상세',
  loading: '신고 상세를 불러오는 중입니다…',
  error: '신고 상세를 불러오지 못했습니다.',
  cachedError:
    '최신 신고 상세를 확인하지 못했습니다. 현재 처리 입력은 그대로 유지됩니다.',
  retry: '신고 상세 다시 확인',
  description: '신고 설명',
  noDescription: '설명이 입력되지 않았습니다.',
  triageTitle: '분류 시작',
  triageDescription: '현재 관리자에게 할당하고 분류됨 상태로 전환합니다.',
  triage: '신고 분류 시작',
  resolutionTitle: '최종 처리',
  outcome: '처리 결과',
  resolutionReason: '처리 사유',
  remediationHint:
    '선택 사항입니다. 같은 문제의 검증된 후속 버전 ID만 허용됩니다.',
  remediationVersionId: '개선 버전 ID',
  resolve: '최종 처리 실행',
  resolved: '처리 완료: {{outcome}}',
  statusChanged: '신고가 {{status}} 상태로 변경됐습니다.',
  resolutionComplete: '신고를 {{status}} 처리했습니다.',
  conflictRefreshFailed:
    '최신 신고 상태를 확인하지 못했습니다. 입력은 유지됩니다. 네트워크를 확인한 뒤 다시 시도해 주세요.',
  conflictRefreshed:
    '최신 신고 상태를 반영했습니다. 입력을 확인한 뒤 작업을 다시 실행해 주세요.',
  mutationError: '신고 상태를 변경하지 못했습니다.',
  retryConflict: '최신 신고 상태 불러오기',
  conflictTitle: '다른 작업에서 신고 상태가 변경됐습니다'
} as const
