export const koAdminFormResources = {
  createPage: {
    title: '새 문제 등록',
    description:
      '자체 제작한 JLPT 문제와 해설을 입력합니다. 초안으로 저장됩니다. 이 화면에서 즉시 게시하지 않습니다.',
    submit: '초안 등록',
    submitting: '등록 중…',
    successTitle: '초안을 등록했습니다',
    successDescription: '아직 학습자에게 공개되지 않았습니다.',
    error:
      '문제를 등록하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.'
  },
  editorPage: {
    breadcrumb: '{{questionId}} 수정',
    title: '문제 수정',
    details: '문제 상세',
    description:
      '{{questionId}} 문제의 수정 가능한 후보 버전 내용과 해설을 저장합니다.',
    submit: '변경사항 저장',
    submitting: '저장 중…',
    successTitle: '문제를 수정했습니다',
    successDescription: '{{questionId}} 문제의 변경사항이 저장되었습니다.',
    readOnly:
      '현재 버전은 수정할 수 없습니다. 활성 문제의 작성자 소유 초안·변경 요청 버전만 수정할 수 있습니다. 게시·검수·새 버전 생성은 이 화면에서 제공하지 않습니다.',
    loading: '문제 정보를 불러오고 있습니다…',
    notFound: '수정할 문제를 찾을 수 없습니다',
    notFoundDescription:
      '문제 ID를 확인하거나 관리자 목록에서 다시 선택해 주세요.',
    goToList: '문제 목록으로 이동',
    loadError: '문제 정보를 불러오지 못했습니다',
    networkError: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
    missingVersion:
      '현재 버전 정보를 확인할 수 없어 편집을 막았습니다. 목록에서 다시 선택하거나 최신 상태를 확인해 주세요.',
    conflict:
      '다른 변경이 먼저 저장되었습니다. 현재 입력은 유지됩니다. 필요한 내용을 복사한 뒤 최신 상태를 다시 불러와 주세요.',
    reload: '최신 상태 다시 불러오기',
    immutable:
      '학습 또는 검수에 사용된 버전은 수정할 수 없습니다. 입력은 유지됩니다.',
    forbidden: '이 버전의 작성자만 수정할 수 있습니다. 입력은 유지됩니다.',
    saveError:
      '변경사항을 저장하지 못했습니다. 입력은 유지됩니다. 내용을 확인한 뒤 다시 시도해 주세요.',
    reloadTitle: '최신 상태로 입력을 교체하시겠습니까?',
    reloadDescription:
      '불러오면 현재 입력 대신 서버의 최신 내용이 표시됩니다. 필요한 내용을 먼저 복사해 주세요.',
    keepInput: '입력 유지',
    replaceInput: '입력 교체하고 불러오기',
    reloadError: '최신 상태를 불러오지 못했습니다. 현재 입력은 유지됩니다.'
  },
  editorForm: {
    screenReaderLegend: '관리자 문제 정보 입력',
    basicTitle: '기본 정보',
    basicDescription:
      '급수, 과목과 문제 유형을 설정합니다. 생성은 초안으로 저장되며 게시 상태는 여기서 변경하지 않습니다.',
    sourceTitle: '문제 출처',
    sourceDescription: '자체 제작한 문제만 등록할 수 있습니다.',
    contentTitle: '문제와 보기',
    contentDescription: '실제 JLPT 기출이 아닌 자체 제작 문항을 입력해 주세요.',
    passageRequired: '지문 (필수)',
    passageOptional: '지문 (선택)',
    passageHint: '독해 문제는 질문과 분리된 일본어 지문이 필요합니다.',
    passagePlaceholder: '예: 안내문이나 짧은 설명문을 입력해 주세요…',
    questionPlaceholder: '예: 글의 내용과 맞는 것을 고르세요…',
    optionsTitle: '보기 4개',
    optionsHint: '빈 보기와 동일한 보기는 저장할 수 없습니다.',
    optionPlaceholder: '내용을 입력해 주세요…',
    correctAnswer: '정답',
    explanationDescription:
      '정답 근거와 오답 이유를 학습자가 이해할 수 있게 설명합니다.',
    explanationKoPlaceholder:
      '정답 근거와 다른 보기가 오답인 이유를 입력해 주세요…',
    explanationJaOptional: '일본어 해설 (선택)',
    explanationJaPlaceholder: '必要な場合、日本語の解説を入力してください…',
    tagPlaceholder: '예: 조사, 문맥, 접속 표현…',
    returnToList: '목록으로 돌아가기',
    leaveTitle: '작성 중인 내용을 나가시겠습니까?',
    leaveDescription: '저장하지 않은 변경사항은 복구할 수 없습니다.',
    keepEditing: '계속 작성',
    discard: '변경사항 버리기',
    validation: {
      level: '급수를 선택해 주세요.',
      subject: '과목을 선택해 주세요.',
      questionType: '문제 유형을 선택해 주세요.',
      difficulty: '난이도를 선택해 주세요.',
      question: '질문을 입력해 주세요.',
      questionLength: '정규화 후 Unicode 문자 1~2000개로 입력해 주세요.',
      passage: '독해 문제는 지문을 입력해 주세요.',
      option: '보기 내용을 입력해 주세요.',
      optionCount: '보기는 정확히 4개여야 합니다.',
      optionDuplicate: '동일한 보기를 중복해서 입력할 수 없습니다.',
      correct: '정답은 보기 중 정확히 하나를 선택해 주세요.',
      explanationKo: '한국어 해설을 입력해 주세요.',
      tags: '태그를 1개 이상 입력해 주세요.'
    }
  }
} as const
