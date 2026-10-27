export const connectionMessages = {
  ko: {
    title: '개발용 연결 상태',
    description: '로컬 API 연결을 확인합니다.',
    checking: '연결 확인 중',
    connected: '연결됨',
    failed: '연결 실패',
    checkingDetail: '로컬 API의 응답을 기다리고 있습니다.',
    connectedDetail: '로컬 API가 정상 응답했습니다.',
    failedDetail:
      '로컬 API 응답을 확인하지 못했습니다. 실행 상태를 확인한 뒤 다시 시도해 주세요.',
    scope:
      '개발 환경 전용입니다. 연결됨은 학습·인증·데이터베이스 전체 정상 판정이 아닙니다.',
    retry: '다시 시도',
    retrying: '다시 확인 중…'
  },
  ja: {
    title: '開発用接続状態',
    description: 'ローカルAPIへの接続を確認します。',
    checking: '接続を確認中',
    connected: '接続済み',
    failed: '接続失敗',
    checkingDetail: 'ローカルAPIの応答を待っています。',
    connectedDetail: 'ローカルAPIが正常に応答しました。',
    failedDetail:
      'ローカルAPIの応答を確認できませんでした。起動状態を確認して再試行してください。',
    scope:
      '開発環境専用です。接続済みは学習・認証・データベース全体の正常判定ではありません。',
    retry: '再試行',
    retrying: '再確認中…'
  }
} as const
