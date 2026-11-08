/** Admin question list screen; kept out of the shared Korean chunk. */
export const koAdminQuestionListResources = {
  title: '문제 관리',
  description:
    '활성 문제의 대표 버전을 관리합니다. 작성·검토 중인 버전이 있으면 먼저 표시하며, 공개본 유무는 별도로 표시합니다. 목록에는 정답과 해설을 노출하지 않습니다.',
  newQuestion: '새 문제 등록',
  unsupportedSort: '상태순 정렬은 지원하지 않아 최근 수정순으로 표시합니다.',
  searchLabel: '문제 검색',
  searchPlaceholder: '질문이 시작하는 내용을 입력하세요…',
  search: '검색',
  sort: '정렬',
  loading: '관리자 문제 목록을 불러오고 있습니다…',
  loadErrorTitle: '문제 목록을 불러오지 못했습니다',
  loadErrorDescription: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
  noMatchTitle: '조건에 맞는 문제가 없어요',
  noMatchDescription: '필터를 줄이거나 검색어를 바꿔 보세요.',
  noQuestionsTitle: '등록된 문제가 없습니다',
  noQuestionsDescription:
    '첫 자체 제작 문제를 등록하여 문제 은행을 구성해 보세요.',
  firstQuestion: '첫 문제 등록',
  emptyTitle: '표시할 문제가 없습니다',
  tableLabel: '관리자 문제 목록',
  tableCaption: 'JLPT 관리자 문제 목록. 수정 및 보관 작업을 포함합니다.',
  columns: {
    id: 'ID',
    level: '급수',
    subject: '과목',
    subjectType: '과목·유형',
    question: '질문',
    difficulty: '난이도',
    status: '상태',
    tags: '태그',
    updatedAt: '수정일',
    actions: '관리'
  },
  published: '공개본 있음',
  archivedNote: '보관됨',
  noDate: '날짜 정보 없음',
  edit: '수정',
  details: '상세 보기',
  archive: '공개 중단·보관',
  batch: {
    selectColumn: '일괄 선택',
    selectRow: '{{questionId}} 문제 선택',
    selectPage: '이 페이지에서 고를 수 있는 문제 모두 선택',
    request: '내 초안 {{count}}개 검수 요청',
    approve: '검수 중 {{count}}개 승인',
    publish: '승인된 {{count}}개 공개',
    scopeNote:
      '내가 만든 초안·수정 요청 문제는 검수 요청, 검수 중인 문제는 승인, 승인된 문제는 공개할 수 있습니다. 페이지나 필터를 바꾸면 선택이 해제됩니다.',
    dialog: {
      more: '외 {{rest}}개',
      cancel: '취소',
      request: {
        title: '문제 {{count}}개를 검수 요청할까요?',
        description:
          '초안을 검수 중으로 바꿉니다. 검수 중에는 승인 전까지 내용을 고칠 수 없습니다.',
        body: '20개씩 나눠 차례로 요청합니다. 한 묶음이 거절되면 그 묶음의 20개는 요청되지 않고 다음 묶음은 계속 보냅니다. 결과는 문제별로 보여 드립니다. 일괄 작업은 15분에 10번까지 보낼 수 있고, 20개 묶음 하나가 1번입니다.',
        confirm: '{{count}}개 검수 요청',
        confirming: '검수 요청 중…',
        notDone: '검수 요청하지 않았습니다.'
      },
      approve: {
        title: '문제 {{count}}개를 승인할까요?',
        description:
          '검수 중인 버전을 승인합니다. 승인한 문제는 공개하기 전까지 학습자에게 보이지 않습니다.',
        body: '문제를 하나씩 승인하므로 중간에 일부만 승인될 수 있습니다. 결과는 문제별로 보여 드립니다.',
        confirm: '{{count}}개 승인',
        confirming: '승인 중…',
        notDone: '승인하지 않았습니다.'
      },
      publish: {
        title: '문제 {{count}}개를 공개할까요?',
        description:
          '승인된 버전이 학습자에게 바로 출제됩니다. 공개 중인 버전이 있으면 이 버전으로 바뀝니다.',
        body: '문제를 하나씩 공개하므로 중간에 일부만 공개될 수 있습니다. 결과는 문제별로 보여 드립니다.',
        confirm: '{{count}}개 공개',
        confirming: '공개 중…',
        notDone: '공개하지 않았습니다.'
      }
    },
    result: {
      close: '닫기',
      request: {
        all: '{{count}}개를 검수 요청했습니다',
        partial: '{{count}}개 검수 요청, {{failed}}개는 요청하지 못했습니다',
        VERSION_CONFLICT: {
          label: '변경 충돌',
          reason:
            '같이 보낸 20개 묶음에 다른 변경이 먼저 저장된 문제가 있어 묶음 전체를 요청하지 않았습니다. 목록을 새로 본 뒤 다시 선택해 주세요.'
        },
        NOT_DRAFT: {
          label: '초안 아님',
          reason:
            '같이 보낸 20개 묶음에 초안·수정 요청 상태가 아닌 문제가 있어 묶음 전체를 요청하지 않았습니다. 목록을 새로 본 뒤 다시 선택해 주세요.'
        },
        NOT_FOUND: {
          label: '찾을 수 없음',
          reason:
            '같이 보낸 20개 묶음에 찾을 수 없는 문제가 있어 묶음 전체를 요청하지 않았습니다. 이미 보관되었을 수 있습니다.'
        },
        RATE_LIMITED: {
          label: '보내지 않음',
          reason:
            '요청 한도(15분에 10번)에 걸려 보내지 않았습니다. 15분쯤 기다린 뒤 다시 선택해 주세요. 그때 관리자 본인 확인을 다시 해야 합니다.'
        },
        FAILED: {
          label: '요청 실패',
          reason:
            '요청 중 문제가 생겨 보내지 않았습니다. 다시 시도하기 전에 목록에서 상태를 확인해 주세요.'
        }
      },
      approve: {
        all: '{{count}}개를 승인했습니다',
        partial: '{{count}}개 승인, {{failed}}개는 승인하지 못했습니다',
        VERSION_CONFLICT: {
          label: '변경 충돌',
          reason:
            '다른 변경이 먼저 저장되었습니다. 목록에서 최신 상태를 확인한 뒤 다시 선택해 주세요.'
        },
        NOT_IN_REVIEW: {
          label: '검수 중 아님',
          reason: '검수 중 상태가 아니어서 승인하지 않았습니다.'
        },
        NOT_FOUND: {
          label: '찾을 수 없음',
          reason: '문제를 찾을 수 없습니다. 이미 보관되었을 수 있습니다.'
        },
        FAILED: {
          label: '승인 실패',
          reason:
            '승인 중 문제가 생겼습니다. 다시 시도하기 전에 목록에서 상태를 확인해 주세요.'
        }
      },
      publish: {
        all: '{{count}}개를 공개했습니다',
        partial: '{{count}}개 공개, {{failed}}개는 공개하지 못했습니다',
        VERSION_CONFLICT: {
          label: '변경 충돌',
          reason:
            '다른 변경이 먼저 저장되었습니다. 목록에서 최신 상태를 확인한 뒤 다시 선택해 주세요.'
        },
        NOT_REVIEWED: {
          label: '승인 안 됨',
          reason: '승인 상태가 아니어서 공개하지 않았습니다.'
        },
        NOT_FOUND: {
          label: '찾을 수 없음',
          reason: '문제를 찾을 수 없습니다. 이미 보관되었을 수 있습니다.'
        },
        FAILED: {
          label: '공개 실패',
          reason:
            '공개 중 문제가 생겼습니다. 다시 시도하기 전에 목록에서 상태를 확인해 주세요.'
        }
      }
    }
  },
  draftDelete: '초안 삭제',
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
    refresh: '최신 상태 확인',
    refreshFailed:
      '최신 상태를 확인하지 못했습니다. 보관은 실행하지 않았습니다.',
    conflict:
      '다른 변경이 먼저 저장되었습니다. 최신 상태를 확인한 뒤 다시 보관해 주세요.',
    failed: '문제를 보관하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    successTitle: '문제를 보관했습니다',
    successDescription: '{{questionId}} 문제가 활성 목록에서 제외되었습니다.'
  }
} as const
