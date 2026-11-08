/** Admin members screen; kept out of the shared Korean chunk. */
export const koAdminMembersResources = {
  title: '가입자',
  description:
    '가입자의 학습 현황과 이용 상태를 확인하고 필요하면 이용을 제한합니다. 이메일은 가려서 보여 줍니다.',
  gridLabel: '가입자 목록',
  loading: '가입자 정보를 불러오는 중입니다.',
  loadError: '가입자 목록을 불러오지 못했습니다',
  empty: '아직 가입자가 없습니다.',
  noMatch: '이 이메일로 가입한 사람이 없습니다.',
  never: '학습 기록 없음',
  openDetail: '상세',
  search: {
    label: '이메일로 찾기',
    hint: '전체 이메일 주소를 정확히 입력해 주세요.',
    submit: '찾기',
    clear: '검색 해제',
    invalid: '올바른 이메일 주소를 입력해 주세요.'
  },
  columns: {
    memberId: '회원 ID',
    email: '이메일',
    joinedAt: '가입일',
    lastStudiedAt: '최근 학습',
    solvedCount: '푼 문제',
    reportCount: '제보',
    status: '상태',
    actions: '상세/조치'
  },
  status: { ACTIVE: '이용 중', RESTRICTED: '이용 제한' },
  detail: {
    title: '가입자 상세',
    back: '가입자 목록으로',
    loadError: '가입자 정보를 불러오지 못했습니다',
    restrictedAt: '제한 시각',
    restrictTitle: '이용 제한',
    restrictHint:
      '제한하면 새 학습·복습 시작과 새 제보를 할 수 없습니다. 로그인과 기록 조회는 계속 됩니다.',
    reason: '제한 사유',
    reasonHint: '{{max}}자 이내로 적어 주세요. 감사 이력에 남습니다.',
    reasonRequired: '제한 사유를 1~{{max}}자로 적어 주세요.',
    restrict: '이용 제한',
    restricting: '제한하는 중…',
    restricted: '이용을 제한했습니다.',
    releaseTitle: '제한 해제',
    releaseHint: '해제하면 바로 다시 학습과 제보를 할 수 있습니다.',
    release: '제한 해제',
    releasing: '해제하는 중…',
    released: '이용 제한을 해제했습니다.',
    confirm: {
      title: '이용을 제한할까요?',
      description: '아래 가입자에게 바로 적용됩니다.',
      preserved: '학습 기록과 보낸 제보는 지워지지 않습니다.',
      cancel: '취소',
      apply: '제한 적용'
    },
    reload: '최신 정보 다시 불러오기'
  }
} as const
