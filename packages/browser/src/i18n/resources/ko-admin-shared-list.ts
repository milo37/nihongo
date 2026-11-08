/** Filters, toolbar and row controls shared by the admin lists. */
export const koAdminSharedListResources = {
  total: '총 {{total}}개',
  range: '· {{from}}–{{to}}',
  totalPending: '개수 확인 중…',
  pageSize: '한 페이지에',
  pageSizeOption: '{{count}}개씩',
  pageStatus: '{{page}} / {{pageCount}}',
  first: '첫 페이지',
  previous: '이전 페이지',
  next: '다음 페이지',
  last: '마지막 페이지',
  pagerTop: '페이지 이동, 목록 위',
  pagerBottom: '페이지 이동, 목록 아래',
  movingPage: '다른 페이지를 불러오는 중…',
  filters: {
    button: '필터',
    buttonCount: '필터 ({{count}})',
    chipValue: '{{label}}: {{value}}',
    remove: '{{label}} 필터 지우기',
    all: '전체',
    reset: '초기화',
    sheetDone: '결과 {{count}}개 보기',
    sheetDonePending: '결과 보기',
    sort: '정렬'
  },
  columns: '열',
  rowMenu: '{{id}} 작업',
  copyId: 'ID 복사',
  copied: '복사했습니다',
  copyFailed: '복사하지 못했습니다',
  selected: '{{count}}개 선택',
  clearSelection: '선택 해제'
} as const
