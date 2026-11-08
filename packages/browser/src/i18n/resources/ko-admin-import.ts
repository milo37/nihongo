/** Admin question import screen; kept out of the shared Korean chunk. */
export const koAdminImportResources = {
  title: '문제 초안 가져오기',
  description:
    "① 파일을 골라 검사합니다(아직 저장하지 않아요). ② 문제가 없으면 '가져오기'를 눌러 모든 문제를 초안으로 한 번에 만듭니다. 하나라도 실패하면 아무것도 만들지 않아요.",
  fileLabel: '가져올 파일 (.json)',
  fileHint: '2MB 이하, 문제 100개까지',
  chooseFile: '파일 선택',
  noFileChosen: '선택한 파일 없음',
  readingFile: '파일을 안전하게 읽고 있습니다…',
  fileSizeError: '빈 파일이거나 2MB보다 커요. 2MB 이하 파일을 골라 주세요.',
  fileFormatError:
    '가져오기 형식에 맞지 않는 파일이에요. 문제 가져오기 안내서의 형식으로 만든 파일인지 확인해 주세요.',
  validate: '검사하기',
  resultTitle: '검사 결과',
  resultCountLabel: '검사한 문제',
  issueCountLabel: '오류',
  valid: '검사 통과',
  invalid: '고칠 곳이 있어요',
  resultCount: '{{formattedCount}}개',
  apply: '{{formattedCount}}개 초안으로 가져오기',
  applied:
    '{{formattedCount}}개 문제를 초안으로 만들었어요. 문제 관리에서 검토해 주세요.',
  error: '가져오기 요청을 처리하지 못했습니다.',
  issueLabel: '{{item}}번 문제 · {{field}} · {{code}}',
  recovery: {
    checking:
      '적용 응답을 받지 못해 같은 가져오기 ID로 적용 결과를 확인하고 있습니다.',
    notApplied:
      '가져오기가 되지 않았어요. 다시 눌러도 문제가 두 번 만들어지지 않아요.',
    failed:
      '결과를 확인하지 못했어요. 다시 눌러도 문제가 두 번 만들어지지 않아요.'
  }
} as const
