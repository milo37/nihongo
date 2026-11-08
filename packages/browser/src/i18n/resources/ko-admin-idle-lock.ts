/** Admin idle lock; kept out of the shared Korean chunk. */
export const koAdminIdleLockResources = {
  title: '15분 동안 사용하지 않아 잠갔습니다',
  description: '입력한 내용은 그대로 있습니다.',
  recheck: '다시 확인',
  checking: '확인 중…',
  failed: '본인 확인이 끝나지 않았습니다. 다시 시도해 주세요.',
  expired:
    '로그인이 끝났습니다. 입력한 내용은 이 화면에 그대로 있습니다. 새 탭에서 다시 로그인한 뒤 이 화면으로 돌아와 다시 확인을 눌러 주세요.',
  signInNewTab: '새 탭에서 로그인'
} as const
