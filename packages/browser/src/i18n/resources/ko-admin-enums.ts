import { questionTypeLabels } from './ko-question-types'

/** Admin enum labels; kept out of the shared Korean chunk. */
export const koAdminEnumsResources = {
  subjects: {
    VOCABULARY: '문자·어휘',
    GRAMMAR: '문법',
    READING: '독해'
  },
  questionTypes: { ...questionTypeLabels },
  difficulties: {
    EASY: '쉬움',
    NORMAL: '보통',
    HARD: '어려움'
  },
  lifecycleStatuses: {
    ACTIVE: '활성',
    ARCHIVED: '보관됨'
  },
  versionStatuses: {
    DRAFT: '초안',
    IN_REVIEW: '검수 중',
    CHANGES_REQUESTED: '수정 요청',
    APPROVED: '승인',
    PUBLISHED: '공개',
    RETIRED: '공개 중단'
  },
  questionSort: {
    UPDATED_DESC: '최근 수정순',
    CREATED_DESC: '최근 생성순',
    LEVEL_ASC: '급수순',
    REPORT_COUNT_DESC: '신고 많은 순',
    CREATED_ASC: '오래된 순'
  },
  reportSort: {
    UPDATED_DESC: '최근 수정순',
    CREATED_DESC: '최근 생성순'
  },
  reportReasons: {
    ANSWER_ERROR: '정답 오류',
    EXPLANATION_ERROR: '해설 오류',
    TYPO_OR_GRAMMAR: '오탈자·문법 오류',
    AMBIGUOUS: '모호한 문제',
    LEVEL_OR_TAXONOMY: '급수·분류 오류',
    OTHER: '기타'
  },
  reportStatuses: {
    OPEN: '접수됨',
    TRIAGED: '분류됨',
    RESOLVED: '해결됨',
    DISMISSED: '기각됨'
  },
  reportOutcomes: {
    RESOLVED: '해결',
    DISMISSED: '기각'
  },
  commands: {
    APPROVE: '승인',
    ARCHIVE: '문제 보관',
    CHANGE_REQUEST: '수정 요청',
    CREATE_VERSION: '새 버전 만들기',
    PUBLISH: '공개',
    REQUEST_REVIEW: '검수 요청',
    RETIRE: '공개 중단',
    WITHDRAW: '승인 철회'
  },
  reviewActions: {
    REQUESTED: '검수 요청',
    CHANGES_REQUESTED: '수정 요청',
    APPROVED: '승인',
    APPROVAL_WITHDRAWN: '승인 철회',
    PUBLISHED: '공개',
    RETIRED: '공개 중단',
    ARCHIVE_ABANDONED: '보관으로 검수 종료',
    AUTHOR_ERASURE_ABANDONED: '작성자 삭제로 검수 종료'
  },
  auditCommands: {
    QUESTION_CREATE: '문제 생성',
    QUESTION_VERSION_CREATE: '문제 버전 생성',
    QUESTION_VERSION_UPDATE: '문제 버전 수정',
    REVIEW_REQUEST: '검수 요청',
    CHANGE_REQUEST: '수정 요청',
    APPROVAL: '승인',
    APPROVAL_WITHDRAWAL: '승인 철회',
    PUBLICATION: '공개',
    RETIREMENT: '공개 중단',
    QUESTION_ARCHIVE: '문제 보관',
    REVIEW_REQUEST_BATCH: '일괄 검수 요청',
    IMPORT_APPLY: '가져오기 적용',
    EXPORT: '내보내기',
    REPORT_TRIAGE: '신고 분류',
    REPORT_RESOLUTION: '신고 최종 처리',
    REAUTHENTICATION: '관리자 본인 확인',
    AUTHOR_ERASURE_ABANDON: '작성자 삭제 후 검수 종료'
  },
  auditTargetTypes: {
    QUESTION: '문제',
    QUESTION_VERSION: '문제 버전',
    QUESTION_REPORT: '문제 신고',
    REVIEW_REQUEST_BATCH: '일괄 검수 요청',
    IMPORT_REQUEST: '가져오기 요청',
    EXPORT_REQUEST: '내보내기 요청',
    ADMIN_SESSION: '관리자 세션',
    USER_ERASURE: '사용자 삭제'
  },
  auditStates: {
    ACTIVE: '활성',
    ARCHIVED: '보관됨',
    DRAFT: '초안',
    IN_REVIEW: '검수 중',
    CHANGES_REQUESTED: '수정 요청',
    APPROVED: '승인',
    PUBLISHED: '공개',
    RETIRED: '공개 중단',
    OPEN: '접수됨',
    TRIAGED: '분류됨',
    RESOLVED: '해결됨',
    DISMISSED: '기각됨',
    SESSION_STALE: '본인 확인 만료',
    SESSION_FRESH: '본인 확인 완료'
  },
  auditChangedFields: {
    LIFECYCLE_STATUS: '문제 수명주기',
    VERSION_STATUS: '버전 상태',
    CURRENT_PUBLISHED_VERSION_ID: '현재 공개 버전',
    LEVEL: '급수',
    SUBJECT: '과목',
    QUESTION_TYPE: '문제 유형',
    DIFFICULTY: '난이도',
    PASSAGE: '지문',
    QUESTION_TEXT: '문제 문장',
    EXPLANATION_KO: '한국어 해설',
    EXPLANATION_JA: '일본어 해설',
    OPTIONS: '보기',
    CORRECT_OPTION: '정답',
    TAGS: '태그',
    ASSIGNEE: '담당자',
    RESOLUTION: '처리 결과',
    REPORT_STATUS: '신고 상태',
    SESSION_ROTATION: '세션 교체',
    IMPORT_ITEMS: '가져오기 항목',
    EXPORT_SELECTION: '내보내기 선택',
    AUTHOR_TOMBSTONE: '삭제된 작성자 표시'
  },
  auditEnvironments: {
    TEST: '테스트',
    DEVELOPMENT: '개발',
    PRODUCTION: '운영'
  },
  actorLabels: {
    ACTIVE_USER: '활성 학습자',
    DELETED_USER: '삭제된 학습자',
    ACTIVE_ADMIN: '활성 관리자',
    DELETED_ADMIN: '삭제된 관리자',
    ACCOUNT_ERASURE: '계정 삭제 시스템 작업'
  },
  diffFields: {
    LEVEL: '급수',
    SUBJECT: '과목',
    QUESTION_TYPE: '문제 유형',
    DIFFICULTY: '난이도',
    PASSAGE: '지문',
    QUESTION_TEXT: '문제 문장',
    EXPLANATION_KO: '한국어 해설',
    EXPLANATION_JA: '일본어 해설',
    OPTIONS: '선택지와 정답',
    TAGS: '태그'
  },
  importIssueCodes: {
    DUPLICATE_CLIENT_ITEM_ID: '가져오기 항목 ID 중복',
    DUPLICATE_CLIENT_OPTION_KEY: '보기 key 중복',
    DUPLICATE_OPTION_TEXT: '보기 내용 중복',
    DUPLICATE_TAG: '태그 중복',
    CORRECT_OPTION_KEY_NOT_FOUND: '정답 보기 key 없음',
    UNKNOWN_TAG: '등록되지 않은 태그',
    TAG_SUBJECT_MISMATCH: '문제 과목과 맞지 않는 태그',
    INVALID_READING_PASSAGE: '독해 지문 규칙 오류',
    INVALID_CONTENT: '문항 내용 오류',
    DUPLICATE_QUESTION_CONTENT: '문항 내용 중복'
  }
} as const
