/** Admin question list screen; kept out of the shared Korean chunk. */
export const koAdminQuestionListResources = {
  eyebrow: 'ADMIN QUESTION CMS',
  title: '문제 관리',
  description:
    '활성 문제의 대표 버전을 관리합니다. 작성·검토 중인 버전이 있으면 먼저 표시하며, 공개본 유무는 별도로 표시합니다. 목록에는 정답과 해설을 노출하지 않습니다.',
  newQuestion: '새 문제 등록',
  unsupportedSort: '상태순 정렬은 지원하지 않아 최근 수정순으로 표시합니다.',
  searchLabel: '문제 검색',
  searchPlaceholder: '질문이 시작하는 내용을 입력하세요…',
  search: '검색',
  filtersLegend: '문제 목록 필터와 정렬',
  allLevels: '전체 급수',
  allSubjects: '전체 과목',
  allStatuses: '모든 표시 버전 상태',
  allDifficulties: '전체 난이도',
  sort: '정렬',
  total: '총 {{formattedCount}}개 문제',
  totalPending: '문제 수를 확인하는 중입니다…',
  resetFilters: '필터 초기화',
  loading: '관리자 문제 목록을 불러오고 있습니다…',
  loadErrorTitle: '문제 목록을 불러오지 못했습니다',
  loadErrorDescription: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
  movingPage: '유효한 문제 목록 페이지로 이동하고 있습니다.',
  noMatchTitle: '검색 조건에 맞는 문제가 없습니다',
  noMatchDescription: '검색어나 필터를 변경하여 다시 확인해 주세요.',
  noQuestionsTitle: '등록된 문제가 없습니다',
  noQuestionsDescription:
    '첫 자체 제작 문제를 등록하여 문제 은행을 구성해 보세요.',
  firstQuestion: '첫 문제 등록',
  emptyTitle: '표시할 문제가 없습니다',
  tableHelp: '표를 좌우로 스크롤하면 모든 열과 관리 버튼을 확인할 수 있습니다.',
  tableLabel: '관리자 문제 목록',
  tableCaption: 'JLPT 관리자 문제 목록. 수정 및 보관 작업을 포함합니다.',
  columns: {
    id: 'ID',
    level: '급수',
    subject: '과목',
    questionType: '유형',
    question: '질문',
    difficulty: '난이도',
    status: '상태',
    tags: '태그',
    updatedAt: '수정일',
    actions: '관리'
  },
  lifecycle: { ACTIVE: '활성', ARCHIVED: '보관' },
  published: '공개본 있음',
  unpublished: '공개본 없음',
  noDate: '날짜 정보 없음',
  edit: '수정',
  details: '상세',
  rowActionLabel: '{{questionId}} 문제 {{action}}',
  archive: '공개 중단·보관',
  archiveLabel: '{{questionId}} 문제 공개 중단·보관',
  draftDelete: '초안 삭제',
  draftDeleteLabel: '{{questionId}} 초안 삭제',
  draftDialog: {
    title: '초안을 삭제하시겠습니까?',
    description:
      '{{questionId}} 초안을 목록에서 지우고 보관합니다. 같은 내용으로 새 문제를 만들 수 없습니다.',
    confirm: '초안 삭제',
    confirming: '삭제 중…',
    failed: '초안을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    successTitle: '초안을 삭제했습니다',
    successDescription: '{{questionId}} 초안을 목록에서 지웠습니다.'
  },
  archiveDialog: {
    title: '이 문제를 공개 중단하고 보관하시겠습니까?',
    description:
      '{{questionId}} 문제를 활성 목록에서 보관합니다. 기존 학습 결과는 유지됩니다.',
    body: '활성 목록과 새 출제 대상에서 제외하고 현재 공개본과 열린 후보의 사용을 종료합니다. 기존 학습 기록은 삭제하지 않습니다.',
    duplicateNote:
      '보관한 문제(초안 포함)와 같은 내용으로는 새 문제를 만들 수 없습니다.',
    cancel: '취소',
    confirm: '공개 중단·보관',
    confirming: '보관 중…',
    reauthenticate: '관리자 재인증',
    refresh: '최신 상태 확인',
    refreshFailed:
      '최신 상태를 확인하지 못했습니다. 보관은 실행하지 않았습니다.',
    freshRequired:
      '관리자 재인증이 필요합니다. 재인증 후 목록에서 다시 확인해 보관해 주세요.',
    conflict:
      '다른 변경이 먼저 저장되었습니다. 최신 상태를 확인한 뒤 다시 보관해 주세요.',
    failed: '문제를 보관하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    successTitle: '문제를 보관했습니다',
    successDescription: '{{questionId}} 문제가 활성 목록에서 제외되었습니다.'
  }
} as const
