import { koAdminFormResources } from './ko-admin-form'

/** Admin question editor screen; kept out of the shared Korean chunk. */
export const koAdminEditorResources = {
  page: koAdminFormResources.editorPage,
  form: koAdminFormResources.editorForm,
  classificationLegend: '분류와 본문',
  level: 'JLPT 급수',
  subject: '과목',
  questionType: '문제 유형',
  difficulty: '난이도',
  questionText: '문제 문장',
  passage: '지문',
  passageHint:
    '독해 문제에는 필수이며, 그 외에는 글의 문법 유형에서만 사용할 수 있습니다.',
  optionsLegend: '보기와 정답',
  reorderHint:
    '이동 버튼 또는 보기 입력란에서 Alt+위/아래 화살표로 순서를 바꿀 수 있습니다.',
  correctOption: '정답 {{number}}',
  optionLabel: '{{number}}번 보기',
  moveUp: '{{number}}번 보기 위로 이동',
  moveDown: '{{number}}번 보기 아래로 이동',
  optionMoved:
    '{{from}}번 보기를 {{to}}번 위치로 이동했습니다. 정답 ID는 유지됩니다.',
  explanationLegend: '해설과 태그',
  explanationKo: '한국어 해설',
  explanationJa: '일본어 해설',
  tagTextHint: '쉼표 또는 줄바꿈으로 구분합니다. 최소 1개가 필요합니다.',
  tagPicker: {
    count: '{{count}}/2',
    placeholder: '태그 검색',
    hint: '문제 과목에 맞는 태그를 1~2개 고르세요.',
    loading: '태그를 불러오는 중…',
    empty:
      '‘{{query}}’로 시작하는 태그가 없습니다. 태그는 여기서 새로 만들 수 없습니다.',
    emptySubject:
      '이 과목에서 고를 수 있는 태그가 없습니다. 태그는 여기서 새로 만들 수 없습니다.',
    more: '더 있을 수 있어요. 이름으로 검색해 주세요.',
    error: '태그 목록을 불러오지 못했습니다.',
    retry: '다시 시도',
    max: '태그는 2개까지 고를 수 있습니다. 바꾸려면 하나를 지워 주세요.',
    overLimit:
      '이 문제에는 태그가 {{count}}개 있습니다. 새 기준은 2개까지라 추가할 수 없습니다. 필요 없는 태그를 지워 주세요.',
    subjectMismatch:
      '문제 과목과 맞지 않는 태그가 있습니다. 지우고 다시 골라 주세요.',
    remove: '{{label}} 태그 지우기',
    removeMismatch: '{{label}} 태그 지우기 (과목 불일치)',
    results: '태그 {{count}}개',
    added: '{{label}} 태그를 추가했습니다',
    removed: '{{label}} 태그를 지웠습니다'
  },
  tagSearch: '등록된 태그 검색',
  tagSuggestions: '등록된 태그 검색 결과',
  tagQueryError: '태그 검색어는 정규화 후 100자 이하여야 합니다.',
  tagLoadError: '태그 목록을 불러오지 못했습니다.',
  tagLoading: '태그를 검색하는 중입니다…',
  tagEmpty: '일치하는 등록 태그가 없습니다.',
  tagOffline: '오프라인에서는 태그를 검색할 수 없습니다.',
  selectedTags: '선택된 태그',
  removeTag: '{{tag}} 태그 제거',
  conflictTitle: '서버 최신본과 로컬 초안을 비교했습니다',
  conflictDescription:
    '다음 필드가 다릅니다. 자동 병합하거나 저장하지 않았습니다.',
  rowVersionOnly: 'rowVersion만 변경됨',
  rebaseAnnouncement:
    '로컬 초안을 최신 rowVersion에 적용하도록 명시적으로 선택했습니다.',
  rebaseAction: '검토한 로컬 초안을 최신 rowVersion에 적용',
  saving: '저장 중…',
  unsavedTitle: '저장하지 않은 변경사항이 있습니다',
  unsavedDescription: '이 페이지를 떠나면 현재 편집 내용이 사라집니다.',
  keepEditing: '계속 편집',
  discardAndLeave: '변경사항 버리고 이동',
  fields: {
    level: 'JLPT 급수',
    subject: '과목',
    questionType: '문제 유형',
    difficulty: '난이도',
    questionText: '문제 문장',
    passage: '지문',
    options: '보기 내용·순서',
    correctIdentity: '정답',
    explanationKo: '한국어 해설',
    explanationJa: '일본어 해설',
    tagNames: '태그'
  }
} as const
