/** Admin re-verification (본인 확인) text; kept out of the shared Korean chunk. */
export const koAdminReauthResources = {
  action: '본인 확인',
  extend: '연장',
  remaining: '본인 확인 · {{minutes}}분 남음',
  remainingShort: '{{minutes}}분 남음',
  scopeAdmin: '관리자 작업은 본인 확인 후 30분 동안 다시 묻지 않습니다.',
  expiringSoon: '본인 확인이 {{minutes}}분 뒤 끝납니다.',
  expired: '본인 확인 시간이 끝났습니다.',
  blocked: '본인 확인 시간이 끝나 ‘{{command}}’ 작업을 적용하지 않았습니다.',
  blockedHelp:
    'Google로 다시 로그인하면 이 화면으로 돌아옵니다. 선택한 문제는 그대로 남으니 버튼을 다시 눌러 주세요.',
  blockedHelpInput:
    'Google로 다시 로그인하면 이 화면으로 돌아옵니다. 입력한 내용은 그대로 남으니 버튼을 다시 눌러 주세요.',
  blockedHelpImport:
    '파일은 보안상 보관할 수 없어, 돌아온 뒤 같은 파일을 다시 선택해 검사해 주세요.',
  storageFailed:
    '입력을 보관하지 못해 본인 확인 화면으로 이동하지 않았습니다. 입력을 복사해 두거나 다시 시도해 주세요.',
  startFailed: 'Google로 이동하지 못했습니다. 다시 시도해 주세요.',
  restored: '이동 전 입력을 되살렸습니다. 내용을 확인한 뒤 직접 실행해 주세요.',
  checking: '본인 확인 결과를 확인하고 있습니다…',
  returned:
    '본인 확인을 마쳤습니다(30분 유효). 작업은 자동 실행되지 않으니 버튼을 다시 눌러 주세요.',
  cancelled: '본인 확인을 취소했습니다. 작업은 적용하지 않았습니다.',
  failed: '본인 확인을 마치지 못했습니다. 작업은 적용하지 않았습니다.',
  invalid: '확인 요청이 만료되었습니다. 다시 시도해 주세요.',
  unknown: '연결 문제로 결과를 확인하지 못했습니다.',
  retry: '다시 시도',
  recheck: '다시 확인'
} as const
