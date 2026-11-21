/** Admin question detail screen; kept out of the shared Korean chunk. */
export const koAdminQuestionDetailResources = {
  editDraft: '초안 편집',
  noPreviousVersion: '비교할 이전 버전이 없습니다.',
  actions: '현재 버전 작업',

  title: '버전과 승인 단계',
  description:
    '다른 곳에서 먼저 고쳤다면, 지금 쓰던 내용은 그대로 두고 새로고침 후 달라진 점을 보여 드립니다.',
  loading: '관리자 문제 상세를 불러오는 중입니다…',
  loadErrorTitle: '문제 상세를 불러오지 못했습니다',
  cachedError:
    '최신 문제 정보를 확인하지 못했습니다. 화면의 편집 내용은 그대로 유지됩니다.',
  retryDetail: '문제 정보 다시 확인',
  history: '버전 기록',
  historyLoading: '이전 버전 불러오는 중…',
  historyMore: '이전 버전 더 보기',
  newDraft: '새 초안 버전 만들기',
  archive: '문제 보관',
  dirtyLock:
    '저장하지 않은 편집 내용이 있어 버전 전환과 승인 단계 작업을 잠갔습니다. 먼저 초안을 저장해 주세요.',
  diffTitle: '이전 버전과 차이',
  diffLoading: '차이를 계산하는 중입니다…',
  diffError: '차이를 불러오지 못했습니다.',
  diffEmpty: '변경된 필드가 없습니다.',
  retryDiff: '차이 다시 불러오기',
  diffListLabel: '버전별 변경 내용',
  diffBefore: '변경 전',
  diffAfter: '변경 후',
  diffBeforeLabel: '{{field}} 변경 전',
  diffAfterLabel: '{{field}} 변경 후',
  correctSuffix: ' (정답)',
  previewTitle: '학습자 공개 화면 미리보기',
  previewDescription:
    '{{status}} 버전의 공개 화면 투영을 읽기 전용으로 표시합니다.',
  answerExplanation: '관리자 정답·해설',
  answer: '정답: {{answer}}',
  previewLoading: '버전 미리보기를 불러오는 중입니다…',
  previewErrorTitle: '미리보기를 불러오지 못했습니다',
  previewCachedError:
    '최신 미리보기를 확인하지 못했습니다. 화면의 편집 내용은 그대로 유지됩니다.',
  retryPreview: '미리보기 다시 확인',
  saveDraft: '초안 변경사항 저장',
  saveComplete: '초안 변경사항을 저장했습니다.',
  versionConflictDescription:
    '다른 탭이나 관리자가 먼저 수정했습니다. 로컬 편집 내용은 유지됩니다.',
  versionConflictTitle: '최신 버전 확인이 필요합니다',
  retryConflict: '최신 rowVersion과 차이 불러오기',
  conflictLoaded:
    '서버의 최신 rowVersion과 차이를 불러왔습니다. 로컬 편집 내용은 유지됩니다.',
  conflictLoadFailed:
    '최신 버전을 확인하지 못했습니다. 로컬 편집 내용은 유지됩니다.',
  reviews: '검수 기록',
  reviewsCachedError:
    '최신 검수 기록을 확인하지 못했습니다. 현재 기록은 그대로 유지됩니다.',
  retryReviews: '검수 기록 다시 확인',
  reviewsLoading: '검수 기록을 불러오는 중입니다…',
  reviewsErrorTitle: '검수 기록을 불러오지 못했습니다',
  reviewsEmpty: '아직 검수 기록이 없습니다.',
  reviewsMoreLoading: '이전 검수 기록 불러오는 중…',
  reviewsMore: '이전 검수 기록 더 보기',
  commandFailedTitle: '명령을 완료하지 못했습니다',
  commandDialogTitle: '{{command}} 확인',
  commandDialogFallbackTitle: '작업 확인',
  commandDialogDescription:
    '다른 관리자가 먼저 바꿨다면 실행하지 않고 알려 드립니다.',
  cancel: '취소',
  execute: '실행',
  requiredReason: '사유',
  optionalReviewNote: '검수 메모 (선택)',
  noteLimit: '메모는 {{formattedCount}}자 이하여야 합니다.',
  commandWarning:
    '이 작업은 학습자 노출과 기록에 영향을 줄 수 있습니다. 결과를 확인한 뒤 실행해 주세요.',
  commandComplete: '{{command}} 작업이 완료됐습니다.',
  sharedPassage: {
    title: '공유 지문',
    shared:
      '이 지문을 문제 {{count}}개가 같이 씁니다. 지문을 고치면 모두 함께 바뀝니다.',
    editing:
      '고친 지문으로 만든 초안 {{count}}개가 한 묶음입니다. 검수 요청·승인·공개는 묶음 전체에 함께 적용됩니다.',
    thisQuestion: '(이 문제)',
    blocked:
      '아래 문제에 열린 버전이 있어 지금은 지문을 고칠 수 없습니다. 먼저 정리해 주세요.',
    edit: '지문 고치기',
    editLabel: '새 지문',
    editHint: '저장하면 문제 {{count}}개마다 이 지문으로 새 초안이 생깁니다.',
    save: '초안 {{count}}개 만들기',
    cancel: '취소',
    saved: '문제 {{count}}개에 고친 지문으로 새 초안을 만들었습니다.',
    conflict:
      '다른 관리자가 먼저 바꿨습니다. 최신 내용을 불러왔으니 다시 확인해 주세요.',
    textError: '바뀐 글자가 없거나 같은 글자의 지문이 이미 있습니다.',
    locked:
      '여러 문제가 같이 쓰는 지문이라 여기서는 고칠 수 없습니다. 문제 상세의 「지문 고치기」를 써 주세요.',
    together: '{{command}} ({{count}}개 함께)'
  }
} as const
