/** Admin report screens; kept out of the shared Korean chunk. */
export const koAdminReportResources = {
  list: {
    title: '버그 리포트',
    description:
      '학습자가 보낸 문항 신고와 앱 오류 제보입니다. 접수됨이 먼저, 최신순으로 보입니다.',
    invalidQuery: '검색 조건을 읽지 못해 기본 조건으로 보여 드립니다.',
    status: '처리 상태',
    kind: '유형',
    loading: '제보를 불러오는 중입니다…',
    refreshing: '제보 목록을 갱신하고 있습니다…',
    error: '제보 목록을 불러오지 못했습니다.',
    cachedError:
      '최신 제보 목록을 확인하지 못했습니다. 현재 목록은 그대로 유지됩니다.',
    retry: '제보 목록 다시 확인',
    empty: {
      all: {
        title: '아직 받은 제보가 없습니다.',
        description: '학습자가 문항 신고나 앱 오류를 보내면 여기에 보입니다.'
      },
      RECEIVED: {
        title: '처리할 제보가 없습니다.',
        description: '새로 들어온 제보를 모두 처리했습니다.'
      },
      ANSWERED: { title: '답변 완료한 제보가 없습니다.' },
      CLOSED: { title: '종결한 제보가 없습니다.' },
      filtered: {
        title: '조건에 맞는 제보가 없습니다.',
        description: '필터를 바꾸거나 [초기화]를 눌러 주세요.'
      }
    },
    details: '상세 보기',
    columns: {
      statusKind: '상태·종류',
      content: '내용',
      locationTime: '발생 위치·시각',
      link: '상세 보기'
    }
  },
  detail: {
    back: '버그 리포트 목록',
    loading: '제보를 불러오는 중입니다…',
    error: '제보를 불러오지 못했습니다.',
    retry: '다시 불러오기',
    content: '제보 내용',
    location: '발생 위치',
    target: '대상 문항',
    reporter: '제보자',
    deletedReporter: '탈퇴한 회원',
    noteTitle: '내부 메모 · 제보자에게 안 보임',
    process: '처리',
    reply: '제보자에게 보낼 답변',
    replyVisible: '제보자가 ‘내 제보’에서 봅니다',
    note: '내부 메모',
    noteHint: '제보자에게 보이지 않습니다.',
    notePlaceholder: '선택 입력',
    replyAndClose: '답변하고 종결',
    saveNote: '메모만 저장',
    close: '답변 없이 종결',
    noNotification: '앱 알림·이메일은 보내지 않습니다.',
    replyRequired: '제보자에게 보낼 답변을 입력해 주세요.',
    sentReply: '보낸 답변',
    repliedAt: '답변 시각',
    closedAt: '종결 시각',
    closedNotice: '종결된 제보는 더 처리할 수 없습니다.',
    repliedClosed: '답변을 보내고 종결했습니다.',
    noteSaved: '내부 메모를 저장했습니다.',
    closed: '답변 없이 종결했습니다.',
    conflict:
      '다른 관리자가 먼저 이 제보를 바꿨습니다. 최신 내용을 불러왔으니 확인한 뒤 다시 처리해 주세요.',
    link: '연결',
    newVersion: '대상 문항 새 버전 만들기',
    noteReplaced:
      '메모 칸을 다른 관리자가 저장한 최신 메모로 바꿨습니다. 내가 쓴 메모는 아래에 따로 남겨 두었습니다.',
    myDraft: '내가 쓴 메모',
    restoreDraft: '내 메모 다시 넣기'
  },
  location: {
    question: '{{screen}} · {{ordinal}}번 문제',
    unknown: '기타 화면 ({{raw}})',
    screens: {
      home: '첫 화면',
      login: '로그인',
      dashboard: '학습 홈',
      practiceSetup: '연습 설정',
      practiceSession: '문제 풀이',
      result: '결과 화면',
      wrongNoteCenter: '복습',
      wrongNoteDetail: '해설 보기',
      bookmarks: '책갈피',
      legal: '약관·정책',
      accountData: '계정 데이터 안내',
      support: '지원 안내',
      forbidden: '접근 권한 없음',
      page: '기타 화면'
    }
  },
  statuses: {
    RECEIVED: '접수됨',
    ANSWERED: '답변 완료',
    CLOSED: '종결'
  },
  kinds: {
    QUESTION: '문항 신고',
    APP_ERROR: '앱 오류'
  }
} as const
