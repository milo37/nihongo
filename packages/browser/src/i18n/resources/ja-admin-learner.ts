/** Admin copy the learner app also shows (JA); see ko-admin-learner. */
import type { LocaleCatalog } from './ja'
import type { koAdminLearnerResources } from './ko-admin-learner'

export const jaAdminLearnerResources = {
  name: '管理者',
  reauth: {
    action: '本人確認',
    extend: '延長',
    remaining: '本人確認・残り{{minutes}}分',
    remainingShort: '残り{{minutes}}分',
    scopeAdmin: '管理者の操作は、本人確認から30分間は再確認しません。',
    expiringSoon: '本人確認はあと{{minutes}}分で切れます。',
    expired: '本人確認の有効時間が切れました。',
    blocked:
      '本人確認の有効時間が切れたため、「{{command}}」は適用していません。',
    blockedHelp:
      'Googleでもう一度ログインすると、この画面に戻ります。選択した問題はそのまま残るので、もう一度ボタンを押してください。',
    blockedHelpInput:
      'Googleでもう一度ログインすると、この画面に戻ります。入力内容はそのまま残るので、もう一度ボタンを押してください。',
    blockedHelpImport:
      'ファイルは安全のため保持できません。戻ったあと、同じファイルを選び直してチェックしてください。',
    storageFailed:
      '入力を保存できなかったため、本人確認に移動しませんでした。入力をコピーしておくか、もう一度お試しください。',
    startFailed: 'Googleに移動できませんでした。もう一度お試しください。',
    restored:
      '移動前の入力を復元しました。内容を確認してから操作してください。',
    checking: '本人確認の結果を確認しています…',
    returned:
      '本人確認が完了しました（30分間有効）。操作は自動実行されないため、もう一度ボタンを押してください。',
    cancelled: '本人確認をキャンセルしました。操作は適用していません。',
    failed: '本人確認を完了できませんでした。操作は適用していません。',
    invalid: '確認リクエストの期限が切れました。もう一度お試しください。',
    unknown: '接続の問題で結果を確認できませんでした。',
    retry: 'もう一度試す',
    recheck: '再確認'
  },
  common: {
    breadcrumbLabel: '現在位置',
    menuLabel: '管理メニュー',
    wideScreenRecommended:
      'この作業は広い画面で行うことをおすすめします。スマートフォンでも続けられます。',
    questions: '問題管理',
    questionDetail: '問題詳細',
    newQuestion: '新しい問題',
    import: 'インポート',
    auditLog: '監査ログ',
    reports: '報告キュー',
    reportDetail: '報告詳細',
    none: 'なし',
    unassigned: '未割り当て',
    open: '開く',
    question: '問題',
    version: 'バージョン',
    status: '状態',
    reason: '理由',
    reporter: '報告者',
    assignee: '担当者',
    actor: '実行者',
    createdAt: '作成日時',
    updatedAt: '更新日時',
    details: '詳細',
    rowVersion: 'rowVersion',
    retryAfter: '{{message}} {{seconds}}秒後にもう一度お試しください。',
    retryAfterMinutes: '{{message}} {{minutes}}分後にもう一度お試しください。',
    pausedTitle: 'オフラインでは最新状態を確認できません',
    pausedDescription:
      '接続が復旧したら再確認してください。最新状態を確認するまで管理者の変更操作は利用できません。',
    cachedPausedDescription:
      'オフラインのため最新状態を確認できませんでした。現在のデータは保持され、管理者の変更操作はロックされています。',
    retry: '最新状態を再確認'
  },
  errors: {
    generic: '管理者リクエストを完了できませんでした。',
    offline: 'オフラインです。入力内容と選択状態は保持されます。',
    authenticationRequired:
      'ログインが必要です。もう一度ログインしてください。',
    sessionExpired:
      'ログインセッションの有効期限が切れました。もう一度ログインしてください。',
    adminRequired: '管理者権限が必要です。',
    forbidden: 'この管理者操作を実行する権限がありません。',
    freshAssuranceRequired: 'この操作には管理者本人確認が必要です。',
    invalidId: 'リクエスト識別子の形式が正しくありません。',
    invalidRequest:
      'リクエスト形式が正しくありません。入力を確認してください。',
    requestTooLarge: 'リクエストサイズが許容範囲を超えています。',
    validation: '入力内容を確認してください。',
    notFound: '指定された管理者データが見つかりません。',
    versionConflict: '別の操作によって最新状態が変更されました。',
    questionVersionImmutable: 'この問題バージョンは変更できません。',
    invalidState: '現在の状態ではこの操作を実行できません。',
    separationOfDuties:
      '作成とレビューの役割を分離する必要があるため、この操作を実行できません。',
    duplicateQuestionContent:
      'アーカイブした問題を含め、同じ内容の問題がすでに存在します。文言を変えてもう一度保存してください。',
    untrustedOrigin: '許可されていないリクエスト元です。',
    rateLimited: 'リクエストが多すぎます。',
    server: 'サーバーで管理者リクエストを処理できませんでした。',
    unavailable: '管理者機能を一時的に利用できません。',
    reportDuplicate: '同じ問題バージョンに処理中の報告があります。',
    importIdentityConflict:
      'インポート項目の識別子が既存データと競合しています。',
    importValidationFailed:
      'インポートの検証結果が現在のリクエストと一致しません。',
    reauthenticationFailed:
      '連携したアカウントで本人確認を完了できませんでした。',
    fieldInvalid: 'この入力値を確認してください。'
  },
  questionReportDialog: {
    trigger: '問題を報告',
    title: '問題を報告',
    description: '送っていただいた内容は運営者だけが見ます。',
    details: 'どこがおかしいですか？',
    descriptionRequired: '内容を書いてください。',
    cancel: 'キャンセル',
    submit: '送る',
    sent: '報告を送りました。ありがとうございます！',
    error: '送れませんでした。もう一度お試しください。',
    offline:
      'インターネット接続が切れました。書いた内容はそのまま残っています。',
    appErrorTrigger: '不具合を知らせる',
    errorScreenTrigger: '不具合を知らせる',
    appErrorTitle: '不具合を知らせる',
    appErrorDescription:
      'どの画面で何をしていたときに問題が起きたか書いてください。運営者だけが見ます。',
    appErrorSent: '知らせていただきありがとうございます。確認します。',
    appErrorError: '送れませんでした。もう一度お試しください。'
  }
} as const satisfies LocaleCatalog<typeof koAdminLearnerResources>
