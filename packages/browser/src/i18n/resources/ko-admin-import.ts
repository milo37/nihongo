/** Admin question import screen; kept out of the shared Korean chunk. */
export const koAdminImportResources = {
  freshRevalidateHint:
    'Google 재확인 화면으로 이동하면 파일 선택과 검증 결과가 초기화됩니다. 돌아온 뒤 같은 JSON 파일을 다시 선택해 검증하고 직접 적용해 주세요.',
  eyebrow: 'ATOMIC IMPORT',
  title: '문제 초안 가져오기',
  description:
    '먼저 쓰기 없는 검증을 수행한 뒤, 동일 항목과 validation digest에 한해서만 전체 적용합니다.',
  fileLabel: 'JSON 파일',
  fileHint: '최대 2 MiB · 최대 100개 · UTF-8 strict JSON',
  readingFile: '파일을 안전하게 읽고 있습니다…',
  fileSizeError: '파일은 1 byte 이상 2 MiB 이하여야 합니다.',
  fileFormatError:
    '중복 JSON 키가 없고 canonical import request 형식인 UTF-8 JSON 파일이 필요합니다.',
  validate: '쓰기 없이 검증',
  valid: '검증 통과',
  invalid: '검증 오류',
  resultCount: '{{formattedCount}}개',
  apply: '동일 검증 결과 원자 적용',
  applied: '{{formattedCount}}개 초안을 원자적으로 만들었습니다.',
  error: '가져오기 요청을 처리하지 못했습니다.',
  issueLabel: '{{code}} · 항목 {{item}} · {{field}}',
  recovery: {
    checking:
      '적용 응답을 받지 못해 같은 가져오기 ID로 적용 결과를 확인하고 있습니다.',
    notApplied:
      '이 가져오기는 적용되지 않았습니다. 다시 적용해도 초안이 중복으로 만들어지지 않습니다.',
    failed:
      '적용 결과를 확인하지 못했습니다. 다시 적용하면 같은 가져오기 ID로 처리되어 초안이 중복으로 만들어지지 않습니다.'
  }
} as const
