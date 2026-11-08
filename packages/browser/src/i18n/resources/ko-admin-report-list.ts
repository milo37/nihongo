/** Admin question report queue; kept out of the shared Korean chunk. */
export const koAdminReportListResources = {
  title: '문제 신고',
  description:
    '목록에는 신고 설명을 보여 주지 않아요. 설명은 신고를 열어 확인해 주세요.',
  invalidQuery: '검색 조건을 읽지 못해 기본 조건으로 보여 드려요.',
  status: '처리 상태',
  allStatuses: '전체 상태',
  reason: '신고 사유',
  allReasons: '전체 사유',
  questionId: '문제 ID',
  assigneeActorId: '담당자 actor ID',
  createdFrom: '신고 생성 시작 시각',
  createdTo: '신고 생성 종료 시각',
  updatedFrom: '신고 수정 시작 시각',
  updatedTo: '신고 수정 종료 시각',
  sort: '정렬',
  applySearch: '검색 적용',
  resetFilters: '필터 초기화',
  cachedError:
    '최신 신고 큐를 확인하지 못했습니다. 현재 목록은 그대로 유지됩니다.',
  error: '신고 큐를 불러오지 못했습니다.',
  retry: '신고 큐 다시 확인',
  loading: '신고 큐를 불러오는 중입니다…',
  refreshing: '신고 큐 페이지를 갱신하고 있습니다…',
  emptyTitle: '신고가 없습니다',
  emptyDescription: '현재 조건에 맞는 신고가 없습니다.',
  tableScrollLabel: '문제 신고 목록 가로 스크롤 영역',
  tableCaption:
    '문제 신고 큐 목록. 상태, 사유, 문제, 신고자, 담당자, 생성일, 수정일, 상세 열로 구성됩니다.',
  sortCreated: '생성일, 최근순으로 정렬',
  sortCreatedActive: '생성일, 최근순 정렬됨',
  sortUpdated: '수정일, 최근순으로 정렬',
  sortUpdatedActive: '수정일, 최근순 정렬됨'
} as const
