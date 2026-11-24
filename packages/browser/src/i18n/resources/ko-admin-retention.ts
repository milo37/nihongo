/** Admin daily return screen (#1266); kept out of the shared Korean chunk. */
export const koAdminRetentionResources = {
  title: '재방문율',
  description:
    '처음 학습한 날(코호트)별로 며칠 뒤에 다시 학습했는지 보여 줍니다. 최근 8주, 사람 단위 정보 없이 숫자만 모았습니다.',
  tableLabel: '일별 재방문율',
  loading: '재방문율을 불러오는 중입니다…',
  error: '재방문율을 불러오지 못했습니다.',
  retry: '재방문율 다시 불러오기',
  emptyTitle: '아직 집계된 날이 없습니다',
  emptyDescription: '코호트 숫자는 하루 지난 뒤부터 쌓입니다.',
  pending: '집계 전',
  audience: { MEMBER: '회원', GUEST: '비회원' },
  columns: {
    cohortDate: '코호트 날짜',
    audience: '구분',
    cohortSize: '코호트 크기',
    day1: '다음 날 재방문',
    weekCohortSize: '7일째 집계 크기',
    day7: '7일째 재방문',
    week1: '첫 주 재방문'
  }
} as const
