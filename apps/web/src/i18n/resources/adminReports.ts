export const adminReportsResources = {
  ko: {
    title: '문제 신고 관리',
    count: '전체 {{formattedCount}}건',
    description: '신고 사유와 처리 상태를 확인하고 상세에서 처리하세요.',
    detailTitle: '문제 신고 상세',
    navigation: '관리 작업',
    advanced: '상세 조건',
    metadata: '신고 정보',
    detailLabel: '{{reason}} 신고 {{id}} 상세',
    returnList: '신고 목록으로',
    targetPending: '대상 문제 상세 화면 연결은 준비 중입니다.',
    reasonHint: '최대 1,000자',
    manualReview: '입력과 최신 신고 상태를 확인한 뒤 직접 실행해 주세요.'
  },
  ja: {
    title: '問題報告の管理',
    count: '全{{formattedCount}}件',
    description: '報告理由と対応状況を確認し、詳細画面で対応してください。',
    detailTitle: '問題報告の詳細',
    navigation: '管理メニュー',
    advanced: '詳細条件',
    metadata: '報告情報',
    detailLabel: '{{reason}}の報告 {{id}} の詳細',
    returnList: '報告一覧へ',
    targetPending: '対象問題の詳細画面への接続は準備中です。',
    reasonHint: '最大1,000文字',
    manualReview: '入力内容と最新の報告状態を確認し、手動で実行してください。'
  }
} as const
