import type { LocaleCatalog } from './ja'
import type { koResources } from './ko'

export const jaAdminResources = {
  name: '管理者',
  grid: {
    columns: '表示する列',
    pageSize: '1ページの行数',
    pageStatus: '{{page}} / {{pageCount}}ページ · 全{{total}}件',
    previous: '前へ',
    next: '次へ'
  },
  adminList: {
    total: '全{{total}}件',
    range: '· {{from}}–{{to}}件',
    totalPending: '件数を確認中…',
    pageSize: '1ページの表示数',
    pageSizeOption: '{{count}}件ずつ',
    pageStatus: '{{page}} / {{pageCount}}',
    first: '最初のページ',
    previous: '前のページ',
    next: '次のページ',
    last: '最後のページ',
    pagerTop: 'ページ移動（一覧の上）',
    pagerBottom: 'ページ移動（一覧の下）',
    movingPage: '別のページを読み込み中…',
    filters: {
      button: '絞り込み',
      buttonCount: '絞り込み（{{count}}）',
      chipValue: '{{label}}: {{value}}',
      remove: '{{label}}の絞り込みを解除',
      all: 'すべて',
      reset: 'リセット',
      sheetDone: '{{count}}件を表示',
      sheetDonePending: '結果を表示',
      sort: '並べ替え'
    },
    columns: '列',
    rowMenu: '{{id}}の操作',
    copyId: 'IDをコピー',
    copied: 'コピーしました',
    copyFailed: 'コピーできませんでした',
    selected: '{{count}}件選択中',
    clearSelection: '選択を解除'
  },
  nav: {
    brand: '하루마루 管理',
    questions: '問題',
    import: 'インポート',
    members: '会員',
    reports: 'バグレポート',
    auditLog: '監査履歴'
  },
  members: {
    title: '会員',
    description:
      '会員の学習状況と利用状態を確認し、必要に応じて利用を制限します。メールアドレスは一部を隠して表示します。',
    gridLabel: '会員一覧',
    loading: '会員情報を読み込んでいます。',
    loadError: '会員一覧を読み込めませんでした',
    empty: 'まだ会員がいません。',
    noMatch: 'このメールアドレスで登録した会員はいません。',
    never: '学習記録なし',
    openDetail: '詳細',
    search: {
      label: 'メールアドレスで検索',
      hint: 'メールアドレス全体を正確に入力してください。',
      submit: '検索',
      clear: '検索を解除',
      invalid: '正しいメールアドレスを入力してください。'
    },
    columns: {
      memberId: '会員ID',
      email: 'メールアドレス',
      joinedAt: '登録日',
      lastStudiedAt: '最近の学習',
      solvedCount: '解いた問題',
      reportCount: '報告',
      status: '状態',
      actions: '詳細'
    },
    status: { ACTIVE: '利用中', RESTRICTED: '利用制限' },
    detail: {
      title: '会員詳細',
      back: '会員一覧へ',
      loadError: '会員情報を読み込めませんでした',
      restrictedAt: '制限日時',
      restrictTitle: '利用制限',
      restrictHint:
        '制限すると新しい学習・復習の開始と新しい報告ができなくなります。ログインと記録の閲覧は引き続き使えます。',
      reason: '制限理由',
      reasonHint: '{{max}}文字以内で入力してください。監査履歴に残ります。',
      reasonRequired: '制限理由を1〜{{max}}文字で入力してください。',
      restrict: '利用を制限',
      restricting: '制限しています…',
      restricted: '利用を制限しました。',
      releaseTitle: '制限解除',
      releaseHint: '解除するとすぐに学習と報告ができるようになります。',
      release: '制限を解除',
      releasing: '解除しています…',
      released: '利用制限を解除しました。',
      fresh: {
        required:
          'セキュリティのため管理者の本人確認が必要です。新しいタブで本人確認を済ませてから、ここで確認完了を押してください。入力内容はそのまま残り、「{{command}}」はまだ適用されていません。',
        openNewTab: '新しいタブで本人確認',
        confirm: '確認完了',
        confirmed:
          '本人確認が完了しました。もう一度「{{command}}」を押して適用してください。',
        failed: '本人確認が完了しなかったため、適用していません。'
      },
      confirm: {
        title: '利用を制限しますか？',
        description: '次の会員にすぐ適用されます。',
        preserved: '学習記録と送信済みの報告は削除されません。',
        cancel: 'キャンセル',
        apply: '制限を適用'
      },
      reload: '最新情報を再読み込み'
    }
  },
  idleLock: {
    title: '15分間使用がなかったためロックしました',
    description: '入力した内容はそのまま残っています。',
    recheck: 'もう一度確認',
    checking: '確認中…',
    failed: '本人確認が完了しませんでした。もう一度お試しください。',
    expired:
      'ログインが終了しました。入力した内容はこの画面にそのまま残っています。新しいタブでもう一度ログインしてから、この画面に戻って「もう一度確認」を押してください。',
    signInNewTab: '新しいタブでログイン'
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
    selectedFile: '選択中: {{fileName}}',
    retryAfter: '{{message}} {{seconds}}秒後にもう一度お試しください。',
    retryAfterMinutes: '{{message}} {{minutes}}分後にもう一度お試しください。',
    pausedTitle: 'オフラインでは最新状態を確認できません',
    pausedDescription:
      '接続が復旧したら再確認してください。最新状態を確認するまで管理者の変更操作は利用できません。',
    cachedPausedDescription:
      'オフラインのため最新状態を確認できませんでした。現在のデータは保持され、管理者の変更操作はロックされています。',
    retry: '最新状態を再確認'
  },
  enums: {
    subjects: {
      VOCABULARY: '文字・語彙',
      GRAMMAR: '文法',
      READING: '読解'
    },
    questionTypes: {
      KANJI_READING: '漢字の読み',
      ORTHOGRAPHY: '表記',
      CONTEXT_VOCABULARY: '文脈語彙',
      PARAPHRASE: '言い換え',
      WORD_USAGE: '用法',
      GRAMMAR_SELECT: '文法選択',
      SENTENCE_ORDER: '文の並べ替え',
      TEXT_GRAMMAR: '文章の文法',
      SHORT_READING: '短文読解',
      MEDIUM_READING: '中文読解',
      LONG_READING: '長文読解',
      INFO_RETRIEVAL: '情報検索'
    },
    difficulties: {
      EASY: 'やさしい',
      NORMAL: '標準',
      HARD: '難しい'
    },
    lifecycleStatuses: {
      ACTIVE: '有効',
      ARCHIVED: 'アーカイブ済み'
    },
    versionStatuses: {
      DRAFT: '下書き',
      IN_REVIEW: 'レビュー中',
      CHANGES_REQUESTED: '修正依頼',
      APPROVED: '承認済み',
      PUBLISHED: '公開中',
      RETIRED: '公開終了'
    },
    questionSort: {
      UPDATED_DESC: '更新が新しい順',
      CREATED_DESC: '作成が新しい順',
      LEVEL_ASC: 'レベル順',
      REPORT_COUNT_DESC: '報告が多い順',
      CREATED_ASC: '古い順'
    },
    reportSort: {
      UPDATED_DESC: '更新が新しい順',
      CREATED_DESC: '作成が新しい順'
    },
    reportReasons: {
      ANSWER_ERROR: '正解の誤り',
      EXPLANATION_ERROR: '解説の誤り',
      TYPO_OR_GRAMMAR: '誤字・文法の誤り',
      AMBIGUOUS: '曖昧な問題',
      LEVEL_OR_TAXONOMY: 'レベル・分類の誤り',
      OTHER: 'その他'
    },
    reportStatuses: {
      OPEN: '受付済み',
      TRIAGED: '分類済み',
      RESOLVED: '解決済み',
      DISMISSED: '却下済み'
    },
    reportOutcomes: {
      RESOLVED: '解決',
      DISMISSED: '却下'
    },
    commands: {
      APPROVE: '承認',
      ARCHIVE: '問題をアーカイブ',
      CHANGE_REQUEST: '修正依頼',
      CREATE_VERSION: '新しいバージョンを作成',
      PUBLISH: '公開',
      REQUEST_REVIEW: 'レビュー依頼',
      RETIRE: '公開終了',
      WITHDRAW: '承認取り消し'
    },
    reviewActions: {
      REQUESTED: 'レビュー依頼',
      CHANGES_REQUESTED: '修正依頼',
      APPROVED: '承認',
      APPROVAL_WITHDRAWN: '承認取り消し',
      PUBLISHED: '公開',
      RETIRED: '公開終了',
      ARCHIVE_ABANDONED: 'アーカイブによりレビュー終了',
      AUTHOR_ERASURE_ABANDONED: '作成者削除によりレビュー終了'
    },
    auditCommands: {
      QUESTION_CREATE: '問題作成',
      QUESTION_VERSION_CREATE: '問題バージョン作成',
      QUESTION_VERSION_UPDATE: '問題バージョン更新',
      REVIEW_REQUEST: 'レビュー依頼',
      CHANGE_REQUEST: '修正依頼',
      APPROVAL: '承認',
      APPROVAL_WITHDRAWAL: '承認取り消し',
      PUBLICATION: '公開',
      RETIREMENT: '公開終了',
      QUESTION_ARCHIVE: '問題のアーカイブ',
      REVIEW_REQUEST_BATCH: '一括レビュー依頼',
      IMPORT_APPLY: 'インポート適用',
      EXPORT: 'エクスポート',
      REPORT_TRIAGE: '報告の分類',
      REPORT_RESOLUTION: '報告の最終処理',
      REAUTHENTICATION: '管理者本人確認',
      AUTHOR_ERASURE_ABANDON: '作成者削除後のレビュー終了'
    },
    auditTargetTypes: {
      QUESTION: '問題',
      QUESTION_VERSION: '問題バージョン',
      QUESTION_REPORT: '問題報告',
      REVIEW_REQUEST_BATCH: '一括レビュー依頼',
      IMPORT_REQUEST: 'インポート要求',
      EXPORT_REQUEST: 'エクスポート要求',
      ADMIN_SESSION: '管理者セッション',
      USER_ERASURE: 'ユーザー削除'
    },
    auditStates: {
      ACTIVE: '有効',
      ARCHIVED: 'アーカイブ済み',
      DRAFT: '下書き',
      IN_REVIEW: 'レビュー中',
      CHANGES_REQUESTED: '修正依頼',
      APPROVED: '承認済み',
      PUBLISHED: '公開中',
      RETIRED: '公開終了',
      OPEN: '受付済み',
      TRIAGED: '分類済み',
      RESOLVED: '解決済み',
      DISMISSED: '却下済み',
      SESSION_STALE: '本人確認期限切れ',
      SESSION_FRESH: '本人確認済み'
    },
    auditChangedFields: {
      LIFECYCLE_STATUS: '問題ライフサイクル',
      VERSION_STATUS: 'バージョン状態',
      CURRENT_PUBLISHED_VERSION_ID: '現在の公開バージョン',
      LEVEL: 'レベル',
      SUBJECT: '科目',
      QUESTION_TYPE: '問題形式',
      DIFFICULTY: '難易度',
      PASSAGE: '本文',
      QUESTION_TEXT: '問題文',
      EXPLANATION_KO: '韓国語解説',
      EXPLANATION_JA: '日本語解説',
      OPTIONS: '選択肢',
      CORRECT_OPTION: '正解',
      TAGS: 'タグ',
      ASSIGNEE: '担当者',
      RESOLUTION: '処理結果',
      REPORT_STATUS: '報告状態',
      SESSION_ROTATION: 'セッション更新',
      IMPORT_ITEMS: 'インポート項目',
      EXPORT_SELECTION: 'エクスポート選択',
      AUTHOR_TOMBSTONE: '削除済み作成者表示'
    },
    auditEnvironments: {
      TEST: 'テスト',
      DEVELOPMENT: '開発',
      PRODUCTION: '本番'
    },
    actorLabels: {
      ACTIVE_USER: '有効な学習者',
      DELETED_USER: '削除済み学習者',
      ACTIVE_ADMIN: '有効な管理者',
      DELETED_ADMIN: '削除済み管理者',
      ACCOUNT_ERASURE: 'アカウント削除システム処理'
    },
    diffFields: {
      LEVEL: 'レベル',
      SUBJECT: '科目',
      QUESTION_TYPE: '問題形式',
      DIFFICULTY: '難易度',
      PASSAGE: '本文',
      QUESTION_TEXT: '問題文',
      EXPLANATION_KO: '韓国語解説',
      EXPLANATION_JA: '日本語解説',
      OPTIONS: '選択肢と正解',
      TAGS: 'タグ'
    },
    importIssueCodes: {
      DUPLICATE_CLIENT_ITEM_ID: 'インポート項目IDの重複',
      DUPLICATE_CLIENT_OPTION_KEY: '選択肢キーの重複',
      DUPLICATE_OPTION_TEXT: '選択肢内容の重複',
      DUPLICATE_TAG: 'タグの重複',
      CORRECT_OPTION_KEY_NOT_FOUND: '正解の選択肢キーがありません',
      UNKNOWN_TAG: '未登録のタグ',
      TAG_SUBJECT_MISMATCH: '問題の科目と合わないタグ',
      INVALID_READING_PASSAGE: '読解本文の規則エラー',
      INVALID_CONTENT: '問題内容のエラー',
      DUPLICATE_QUESTION_CONTENT: '問題内容の重複'
    }
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
  freshAssurance: {
    title: '管理者本人確認',
    description:
      '{{reason}} 連携したアカウントで本人確認後、操作ボタンをもう一度押す必要があります。',
    cancel: 'キャンセル',
    checkingSession: 'ログイン状態を確認しています…',
    retrySession: 'ログイン状態を再確認',
    checking: '確認しています…',
    confirm: '本人確認',
    complete:
      'ログイン状態を再確認しました。元の操作は自動実行されていません。内容を確認してから手動でもう一度実行してください。',
    recovered:
      '現在の管理者セッションを確認しました。連携したアカウントで本人確認をやり直してください。',
    recoveryFailed:
      'ログイン状態を確認できませんでした。ローカル作業は保持されます。ログイン状態の確認をもう一度お試しください。',
    failed: '本人確認を完了できませんでした。',
    reasons: {
      BATCH_REVIEW: '一括レビュー依頼は慎重な確認が必要な管理者操作です。',
      EXPORT: '問題のエクスポートには機密性のある正解と解説が含まれます。',
      IMPORT_APPLY: 'インポートの適用は複数の問題を作成する管理者操作です。',
      QUESTION_APPROVE: '承認は慎重な確認が必要な管理者操作です。',
      QUESTION_ARCHIVE: '問題のアーカイブは慎重な確認が必要な管理者操作です。',
      QUESTION_PUBLISH: '公開は慎重な確認が必要な管理者操作です。',
      QUESTION_RETIRE: '公開終了は慎重な確認が必要な管理者操作です。',
      QUESTION_WITHDRAW: '承認取り消しは慎重な確認が必要な管理者操作です。',
      REPORT_RESOLUTION: '報告の最終処理は慎重な確認が必要な管理者操作です。'
    }
  },
  questionList: {
    title: '問題管理',
    description:
      '有効な問題の代表バージョンを管理します。作成中・レビュー中のバージョンがあれば優先して表示し、公開版の有無は別に表示します。一覧には正解と解説を表示しません。',
    newQuestion: '新しい問題を登録',
    unsupportedSort:
      'ステータス順の並べ替えには対応していないため、更新が新しい順で表示します。',
    searchLabel: '問題を検索',
    searchPlaceholder: '問題文の書き出しを入力してください…',
    search: '検索',
    sort: '並べ替え',
    loading: '管理者用の問題一覧を読み込んでいます…',
    loadErrorTitle: '問題一覧を読み込めませんでした',
    loadErrorDescription:
      'ネットワークの状態を確認してから、もう一度お試しください。',
    noMatchTitle: '条件に合う問題はありません',
    noMatchDescription: '絞り込みを減らすか、検索語を変えてください。',
    noQuestionsTitle: '登録された問題はありません',
    noQuestionsDescription:
      '最初のオリジナル問題を登録して、問題バンクを作りましょう。',
    firstQuestion: '最初の問題を登録',
    emptyTitle: '表示する問題がありません',
    tableLabel: '管理者用の問題一覧',
    tableCaption: 'JLPT管理者用の問題一覧。編集とアーカイブの操作を含みます。',
    columns: {
      id: 'ID',
      level: 'レベル',
      subject: '科目',
      subjectType: '科目・形式',
      question: '問題文',
      difficulty: '難易度',
      status: 'ステータス',
      tags: 'タグ',
      updatedAt: '更新日',
      actions: '管理'
    },
    published: '公開版あり',
    archivedNote: 'アーカイブ済み',
    noDate: '日付情報なし',
    edit: '編集',
    details: '詳細を見る',
    archive: '公開終了・アーカイブ',
    batch: {
      selectColumn: '一括選択',
      selectRow: '問題{{questionId}}を選択',
      selectPage: 'このページで選択できる問題をすべて選択',
      request: '自分の下書き{{count}}問をレビュー依頼',
      approve: 'レビュー中の{{count}}問を承認',
      publish: '承認済みの{{count}}問を公開',
      scopeNote:
        '自分が作成した下書き・修正依頼の問題はレビュー依頼、レビュー中の問題は承認、承認済みの問題は公開できます。ページやフィルターを変えると、選択は解除されます。',
      dialog: {
        more: 'ほか{{rest}}問',
        cancel: 'キャンセル',
        freshAfterWait:
          '待った後にもう一度送るときは、管理者の本人確認をもう一度行う必要があります。',
        request: {
          title: '{{count}}問をレビュー依頼しますか？',
          description:
            '下書きをレビュー中に変えます。レビュー中は、承認されるまで内容を編集できません。',
          body: '20問ずつに分けて順に依頼します。1つのまとまりが拒否されると、そのまとまりの20問は依頼されず、次のまとまりは引き続き送ります。結果は問題ごとに表示します。一括操作は15分に10回まで送れ、20問のまとまり1つが1回です。',
          confirm: '{{count}}問をレビュー依頼',
          confirming: 'レビュー依頼中…',
          notDone: 'レビュー依頼していません。'
        },
        approve: {
          title: '{{count}}問を承認しますか？',
          description:
            'レビュー中のバージョンを承認します。承認した問題は、公開するまで学習者には表示されません。',
          body: '1問ずつ承認するため、途中で一部だけ承認される場合があります。結果は問題ごとに表示します。',
          confirm: '{{count}}問を承認',
          confirming: '承認中…',
          notDone: '承認していません。'
        },
        publish: {
          title: '{{count}}問を公開しますか？',
          description:
            '承認済みのバージョンがすぐに学習者に出題されます。公開中のバージョンがある場合は、このバージョンに切り替わります。',
          body: '1問ずつ公開するため、途中で一部だけ公開される場合があります。結果は問題ごとに表示します。',
          confirm: '{{count}}問を公開',
          confirming: '公開中…',
          notDone: '公開していません。'
        }
      },
      result: {
        close: '閉じる',
        request: {
          all: '{{count}}問をレビュー依頼しました',
          partial:
            '{{count}}問をレビュー依頼し、{{failed}}問は依頼できませんでした',
          VERSION_CONFLICT: {
            label: '変更の競合',
            reason:
              '一緒に送った20問のまとまりに、別の変更が先に保存された問題があったため、まとまり全体を依頼していません。一覧を更新してから、もう一度選択してください。'
          },
          NOT_DRAFT: {
            label: '下書きではない',
            reason:
              '一緒に送った20問のまとまりに、下書き・修正依頼ではない問題があったため、まとまり全体を依頼していません。一覧を更新してから、もう一度選択してください。'
          },
          NOT_FOUND: {
            label: '見つかりません',
            reason:
              '一緒に送った20問のまとまりに、見つからない問題があったため、まとまり全体を依頼していません。すでにアーカイブされた可能性があります。'
          },
          RATE_LIMITED: {
            label: '未送信',
            reason:
              '送信回数の上限（15分に10回）に達したため、送っていません。15分ほど待ってから、もう一度選択してください。その際、管理者の本人確認をもう一度行う必要があります。'
          },
          FAILED: {
            label: '依頼失敗',
            reason:
              '依頼中に問題が発生したため、送っていません。もう一度試す前に、一覧で状態を確認してください。'
          }
        },
        approve: {
          all: '{{count}}問を承認しました',
          partial: '{{count}}問を承認し、{{failed}}問は承認できませんでした',
          VERSION_CONFLICT: {
            label: '変更の競合',
            reason:
              '別の変更が先に保存されました。一覧で最新の状態を確認してから、もう一度選択してください。'
          },
          NOT_IN_REVIEW: {
            label: 'レビュー中ではない',
            reason: 'レビュー中ではないため、承認していません。'
          },
          NOT_FOUND: {
            label: '見つかりません',
            reason:
              '問題が見つかりません。すでにアーカイブされた可能性があります。'
          },
          FAILED: {
            label: '承認失敗',
            reason:
              '承認中に問題が発生しました。もう一度試す前に、一覧で状態を確認してください。'
          }
        },
        publish: {
          all: '{{count}}問を公開しました',
          partial: '{{count}}問を公開し、{{failed}}問は公開できませんでした',
          VERSION_CONFLICT: {
            label: '変更の競合',
            reason:
              '別の変更が先に保存されました。一覧で最新の状態を確認してから、もう一度選択してください。'
          },
          NOT_REVIEWED: {
            label: '未承認',
            reason: '承認済みではないため、公開していません。'
          },
          NOT_FOUND: {
            label: '見つかりません',
            reason:
              '問題が見つかりません。すでにアーカイブされた可能性があります。'
          },
          FAILED: {
            label: '公開失敗',
            reason:
              '公開中に問題が発生しました。もう一度試す前に、一覧で状態を確認してください。'
          }
        }
      }
    },
    draftDelete: '下書きを削除',
    draftDialog: {
      title: '下書きを削除しますか？',
      description:
        '下書き{{questionId}}を一覧から外してアーカイブします。同じ内容で新しい問題を作成することはできません。',
      confirm: '下書きを削除',
      confirming: '削除中…',
      failed:
        '下書きを削除できませんでした。しばらくしてから、もう一度お試しください。',
      successTitle: '下書きを削除しました',
      successDescription: '下書き{{questionId}}を一覧から外しました。'
    },
    archiveDialog: {
      title: 'この問題を公開終了してアーカイブしますか？',
      description:
        '問題{{questionId}}を有効な一覧からアーカイブします。これまでの学習結果は残ります。',
      body: '有効な一覧と新しい出題対象から外し、現在の公開版と作業中の候補の利用を終了します。これまでの学習記録は削除しません。',
      duplicateNote:
        'アーカイブした問題（下書きを含む）と同じ内容では、新しい問題を作成できません。',
      cancel: 'キャンセル',
      confirm: '公開終了・アーカイブ',
      confirming: 'アーカイブ中…',
      reauthenticate: '管理者の再認証',
      refresh: '最新の状態を確認',
      refreshFailed:
        '最新の状態を確認できませんでした。アーカイブは実行していません。',
      freshRequired:
        '管理者の再認証が必要です。再認証後、一覧で確認してからアーカイブしてください。',
      conflict:
        '別の変更が先に保存されました。最新の状態を確認してから、もう一度アーカイブしてください。',
      failed:
        '問題をアーカイブできませんでした。しばらくしてから、もう一度お試しください。',
      successTitle: '問題をアーカイブしました',
      successDescription: '問題{{questionId}}を有効な一覧から外しました。'
    }
  },
  create: {
    page: {
      title: '新しい問題を登録',
      description:
        '自作のJLPT問題と解説を入力します。下書きとして保存され、この画面からすぐに公開されることはありません。',
      submit: '下書きを登録',
      submitting: '登録中…',
      successTitle: '下書きを登録しました',
      successDescription: '学習者にはまだ公開されていません。',
      error:
        '問題を登録できませんでした。入力内容を確認して、もう一度お試しください。'
    },
    eyebrow: 'CREATE DRAFT',
    title: '新しい問題の下書きを作成',
    description:
      '作成結果は必ず新しい下書きバージョンになります。フォームから公開状態を直接指定することはできません。',
    submit: '下書きを作成',
    error: '問題を作成できませんでした。'
  },
  editor: {
    page: {
      breadcrumb: '{{questionId}}を編集',
      title: '問題の編集',
      details: '問題の詳細',
      description:
        '問題{{questionId}}の編集可能な候補バージョンの内容と解説を保存します。',
      submit: '変更を保存',
      submitting: '保存中…',
      successTitle: '問題を編集しました',
      successDescription: '問題{{questionId}}の変更を保存しました。',
      readOnly:
        '現在のバージョンは編集できません。有効な問題の作成者が所有する下書き・修正依頼バージョンのみ編集できます。この画面では公開・レビュー・新規バージョン作成はできません。',
      loading: '問題情報を読み込んでいます…',
      notFound: '編集する問題が見つかりません',
      notFoundDescription:
        '問題IDを確認するか、管理者一覧から選び直してください。',
      goToList: '問題一覧へ移動',
      loadError: '問題情報を読み込めませんでした',
      networkError: 'ネットワークを確認して、もう一度お試しください。',
      missingVersion:
        '現在のバージョン情報を確認できないため、編集を停止しました。一覧から選び直すか、最新状態を確認してください。',
      conflict:
        '別の変更が先に保存されました。現在の入力は保持されています。必要な内容をコピーしてから、最新状態を再読み込みしてください。',
      reload: '最新状態を再読み込み',
      immutable:
        '学習またはレビューに使用されたバージョンは編集できません。入力は保持されます。',
      forbidden: 'このバージョンの作成者のみ編集できます。入力は保持されます。',
      saveError:
        '変更を保存できませんでした。入力は保持されます。内容を確認して、もう一度お試しください。',
      reloadTitle: '入力を最新状態に置き換えますか？',
      reloadDescription:
        '再読み込みすると、現在の入力はサーバーの最新内容に置き換わります。必要な内容を先にコピーしてください。',
      keepInput: '入力を保持',
      replaceInput: '入力を置き換えて読み込む',
      reloadError:
        '最新状態を読み込めませんでした。現在の入力は保持されています。'
    },
    form: {
      screenReaderLegend: '管理者用の問題情報入力',
      basicTitle: '基本情報',
      basicDescription:
        'レベル、科目、問題形式を設定します。作成時は下書きとして保存され、ここでは公開状態を変更できません。',
      sourceTitle: '問題の出典',
      sourceDescription: '自作の問題のみ登録できます。',
      contentTitle: '問題と選択肢',
      contentDescription:
        '実際のJLPT過去問ではなく、自作の問題を入力してください。',
      passageRequired: '本文（必須）',
      passageOptional: '本文（任意）',
      passageHint: '読解問題には、問題文とは別に日本語の本文が必要です。',
      passagePlaceholder: '例：案内文や短い説明文を入力してください…',
      questionPlaceholder: '例：文章の内容に合うものを選んでください…',
      optionsTitle: '選択肢4つ',
      optionsHint: '空の選択肢や同じ選択肢は保存できません。',
      optionPlaceholder: '内容を入力してください…',
      correctAnswer: '正解',
      explanationDescription:
        '正解の根拠と他の選択肢が誤りである理由を、学習者が理解できるように説明します。',
      explanationKoPlaceholder:
        '正解の根拠と他の選択肢が誤りである理由を入力してください…',
      explanationJaOptional: '日本語解説（任意）',
      explanationJaPlaceholder: '必要な場合、日本語の解説を入力してください…',
      tagPlaceholder: '例：助詞、文脈、接続表現…',
      returnToList: '一覧に戻る',
      leaveTitle: '編集中の画面を離れますか？',
      leaveDescription: '保存していない変更は復元できません。',
      keepEditing: '編集を続ける',
      discard: '変更を破棄する',
      validation: {
        level: 'レベルを選択してください。',
        subject: '科目を選択してください。',
        questionType: '問題形式を選択してください。',
        difficulty: '難易度を選択してください。',
        question: '問題文を入力してください。',
        questionLength: '正規化後のUnicode文字を1〜2000個で入力してください。',
        passage: '読解問題には本文を入力してください。',
        passageNotAllowed:
          'この問題タイプには本文を使えません。本文を空にしてください。',
        combination:
          '選択した級・科目・問題タイプの組み合わせは登録できません。',
        option: '選択肢の内容を入力してください。',
        optionCount: '選択肢は4つ必要です。',
        optionDuplicate: '同じ選択肢を重複して入力できません。',
        correct: '正解は選択肢から1つ選んでください。',
        explanationKo: '韓国語解説を入力してください。',
        tags: 'タグを1つ以上選んでください。',
        invalid: '入力の形式・長さ・数を確認してください。'
      }
    },
    classificationLegend: '分類と本文',
    level: 'JLPTレベル',
    subject: '科目',
    questionType: '問題形式',
    difficulty: '難易度',
    questionText: '問題文',
    passage: '本文',
    passageHint:
      '読解問題では必須です。それ以外では文章の文法形式にのみ使用できます。',
    optionsLegend: '選択肢と正解',
    reorderHint:
      '移動ボタン、または選択肢の入力欄でAlt+上下矢印キーを押すと順序を変更できます。',
    correctOption: '正解 {{number}}',
    optionLabel: '選択肢{{number}}',
    moveUp: '選択肢{{number}}を上へ移動',
    moveDown: '選択肢{{number}}を下へ移動',
    optionMoved:
      '選択肢{{from}}を{{to}}番目へ移動しました。正解IDは保持されています。',
    explanationLegend: '解説とタグ',
    explanationKo: '韓国語解説',
    explanationJa: '日本語解説',
    tagTextHint: 'カンマまたは改行で区切ってください。1つ以上必要です。',
    tagPicker: {
      count: '{{count}}/2',
      placeholder: 'タグを検索',
      hint: '問題の科目に合うタグを1〜2個選んでください。',
      loading: 'タグを読み込み中…',
      empty:
        '「{{query}}」で始まるタグはありません。ここではタグを新しく作れません。',
      emptySubject:
        'この科目で選べるタグはありません。ここではタグを新しく作れません。',
      more: 'ほかにもある場合があります。名前で検索してください。',
      error: 'タグの一覧を読み込めませんでした。',
      retry: 'もう一度試す',
      max: 'タグは2個まで選べます。変えるときは1つ削除してください。',
      overLimit:
        'この問題にはタグが{{count}}個あります。新しい基準では2個までのため追加できません。不要なタグを削除してください。',
      subjectMismatch:
        '問題の科目と合わないタグがあります。削除して選び直してください。',
      remove: 'タグ「{{label}}」を削除',
      removeMismatch: 'タグ「{{label}}」を削除（科目不一致）',
      results: 'タグ{{count}}個',
      added: 'タグ「{{label}}」を追加しました',
      removed: 'タグ「{{label}}」を削除しました'
    },
    tagSearch: '登録済みタグを検索',
    tagSuggestions: '登録済みタグの検索結果',
    tagQueryError: 'タグ検索語は正規化後100文字以下にしてください。',
    tagLoadError: 'タグ一覧を読み込めませんでした。',
    tagLoading: 'タグを検索しています…',
    tagEmpty: '一致する登録済みタグはありません。',
    tagOffline: 'オフラインではタグを検索できません。',
    selectedTags: '選択済みタグ',
    removeTag: '{{tag}}タグを削除',
    conflictTitle: 'サーバーの最新版とローカル下書きを比較しました',
    conflictDescription:
      '次のフィールドが異なります。自動マージや保存は行っていません。',
    rowVersionOnly: 'rowVersionのみ変更',
    rebaseAnnouncement:
      'ローカル下書きを最新rowVersionへ適用することを明示的に選択しました。',
    rebaseAction: '確認済みのローカル下書きを最新rowVersionへ適用',
    saving: '保存しています…',
    unsavedTitle: '保存していない変更があります',
    unsavedDescription: 'このページを離れると現在の編集内容は失われます。',
    keepEditing: '編集を続ける',
    discardAndLeave: '変更を破棄して移動',
    fields: {
      level: 'JLPTレベル',
      subject: '科目',
      questionType: '問題形式',
      difficulty: '難易度',
      questionText: '問題文',
      passage: '本文',
      options: '選択肢の内容・順序',
      correctIdentity: '正解',
      explanationKo: '韓国語解説',
      explanationJa: '日本語解説',
      tagNames: 'タグ'
    }
  },
  questionDetail: {
    editDraft: '下書きを編集',
    noPreviousVersion: '比較する前のバージョンはありません。',
    actions: '現在のバージョンの操作',

    title: '問題バージョンワークフロー',
    description:
      '行バージョンが競合した場合もローカル編集内容は保持され、再読み込み後に差分を確認できます。',
    loading: '管理者用問題の詳細を読み込んでいます…',
    loadErrorTitle: '問題詳細を読み込めませんでした',
    cachedError:
      '問題の最新情報を確認できませんでした。画面上の編集内容は保持されます。',
    retryDetail: '問題情報を再確認',
    history: 'バージョン履歴',
    historyLoading: '以前のバージョンを読み込んでいます…',
    historyMore: '以前のバージョンをさらに表示',
    newDraft: '新しい下書きバージョンを作成',
    archive: '問題をアーカイブ',
    dirtyLock:
      '未保存の編集内容があるため、バージョン切り替えとワークフロー操作をロックしました。先に下書きを保存してください。',
    diffTitle: '前のバージョンとの差分',
    diffLoading: '差分を計算しています…',
    diffError: '差分を読み込めませんでした。',
    diffEmpty: '変更されたフィールドはありません。',
    retryDiff: '差分を再読み込み',
    diffListLabel: 'バージョンごとの変更内容',
    diffBefore: '変更前',
    diffAfter: '変更後',
    diffBeforeLabel: '{{field}}の変更前',
    diffAfterLabel: '{{field}}の変更後',
    correctSuffix: '（正解）',
    previewTitle: '学習者向け公開画面のプレビュー',
    previewDescription:
      '{{status}}バージョンの公開画面投影を読み取り専用で表示します。',
    answerExplanation: '管理者用の正解・解説',
    answer: '正解: {{answer}}',
    previewLoading: 'バージョンプレビューを読み込んでいます…',
    previewErrorTitle: 'プレビューを読み込めませんでした',
    previewCachedError:
      '最新プレビューを確認できませんでした。画面上の編集内容は保持されます。',
    retryPreview: 'プレビューを再確認',
    saveDraft: '下書きの変更を保存',
    saveComplete: '下書きの変更を保存しました。',
    versionConflictDescription:
      '別のタブまたは管理者が先に更新しました。ローカル編集内容は保持されます。',
    versionConflictTitle: '最新バージョンの確認が必要です',
    retryConflict: '最新rowVersionと差分を読み込む',
    conflictLoaded:
      'サーバーの最新rowVersionと差分を読み込みました。ローカル編集内容は保持されます。',
    conflictLoadFailed:
      '最新バージョンを確認できませんでした。ローカル編集内容は保持されます。',
    reviews: 'レビュー履歴',
    reviewsCachedError:
      '最新のレビュー履歴を確認できませんでした。現在の履歴は保持されます。',
    retryReviews: 'レビュー履歴を再確認',
    reviewsLoading: 'レビュー履歴を読み込んでいます…',
    reviewsErrorTitle: 'レビュー履歴を読み込めませんでした',
    reviewsEmpty: 'レビュー履歴はまだありません。',
    reviewsMoreLoading: '以前のレビュー履歴を読み込んでいます…',
    reviewsMore: '以前のレビュー履歴をさらに表示',
    commandFailedTitle: 'コマンドを完了できませんでした',
    commandDialogTitle: '{{command}}の確認',
    commandDialogFallbackTitle: '操作の確認',
    commandDialogDescription:
      'ほかの管理者が先に変更していた場合は、実行せずにお知らせします。',
    cancel: 'キャンセル',
    execute: '実行',
    requiredReason: '理由',
    optionalReviewNote: 'レビューメモ（任意）',
    noteLimit: 'メモは{{formattedCount}}文字以下にしてください。',
    commandWarning:
      'この操作は学習者への表示と記録に影響する場合があります。結果を確認してから実行してください。',
    commandComplete: '{{command}}を完了しました。'
  },
  import: {
    freshRevalidateHint:
      '本人確認のためGoogleへ移動すると、選んだファイルとチェック結果は消えます。戻ったら同じファイルを選び直し、チェックしてからインポートを押してください。',
    title: '問題の下書きをインポート',
    description:
      '①ファイルを選んでチェックします（まだ保存しません）。②問題がなければ「インポート」を押して、すべての問題を下書きとして一度に作成します。1件でも失敗した場合は何も作成しません。',
    fileLabel: 'インポートするファイル（.json）',
    fileHint: '2MB以下、問題100件まで',
    chooseFile: 'ファイルを選択',
    noFileChosen: 'ファイルが選択されていません',
    readingFile: 'ファイルを安全に読み込んでいます…',
    fileSizeError:
      '空のファイルか、2MBを超えています。2MB以下のファイルを選んでください。',
    fileFormatError:
      'インポート形式に合わないファイルです。問題インポートの手順書の形式で作成したファイルか確認してください。',
    validate: 'チェックする',
    resultTitle: 'チェック結果',
    resultCountLabel: 'チェックした問題',
    issueCountLabel: 'エラー',
    valid: 'チェック通過',
    invalid: '修正が必要な箇所があります',
    resultCount: '{{formattedCount}}件',
    apply: '{{formattedCount}}件を下書きとしてインポート',
    applied:
      '{{formattedCount}}件の問題を下書きとして作成しました。問題管理で確認してください。',
    error: 'インポート要求を処理できませんでした。',
    issueLabel: '{{item}}件目 · {{field}} · {{code}}',
    recovery: {
      checking:
        '適用の応答を受け取れなかったため、同じインポートIDで適用結果を確認しています。',
      notApplied:
        'インポートされませんでした。もう一度押しても問題が二重に作成されることはありません。',
      failed:
        '結果を確認できませんでした。もう一度押しても問題が二重に作成されることはありません。'
    }
  },
  audit: {
    eyebrow: 'ADMIN AUDIT',
    title: '管理者監査ログ',
    description:
      '機密性のある問題本文ではなく、許可された状態とdigestの証跡のみ表示します。',
    cachedError:
      '最新の監査ログを確認できませんでした。現在のログは保持されます。',
    retry: '監査ログを再確認',
    loading: '監査ログを読み込んでいます…',
    error: '監査ログを読み込めませんでした。',
    emptyTitle: '監査ログがありません',
    emptyDescription: '記録された管理者コマンドはまだありません。',
    stateChange: '状態変更',
    changedFields: '変更フィールド',
    requestEnvironment: 'リクエスト {{requestId}} · 環境 {{environment}}',
    moreLoading: '以前の監査ログを読み込んでいます…',
    more: '以前の監査ログをさらに表示'
  },
  questionReportDialog: {
    trigger: '問題を報告',
    title: '問題を報告',
    description: '報告内容は管理者のみが確認し、HTMLとして解釈されません。',
    details: '説明',
    descriptionRequired: '報告の説明を入力してください。',
    cancel: 'キャンセル',
    submit: '報告を送信',
    submitted: '問題の報告を受け付けました。',
    error: '問題の報告を受け付けられませんでした。',
    offline: 'オフラインです。入力した説明は保持されます。',
    appErrorTrigger: 'アプリの不具合を報告',
    errorScreenTrigger: '不具合を報告',
    appErrorTitle: 'アプリの不具合を報告',
    appErrorDescription:
      'どの画面で何をしていたときに問題が起きたかを入力してください。報告内容は管理者のみが確認します。',
    appErrorSubmitted: 'アプリの不具合報告を受け付けました。',
    appErrorError: 'アプリの不具合報告を受け付けられませんでした。'
  },
  reportList: {
    title: '問題報告',
    description:
      '一覧では報告の説明を表示しません。説明は報告を開いて確認してください。',
    invalidQuery: '検索条件を読み取れなかったため、初期条件で表示しています。',
    status: '処理状態',
    allStatuses: 'すべての状態',
    reason: '報告理由',
    allReasons: 'すべての理由',
    questionId: '問題ID',
    assigneeActorId: '担当者actor ID',
    createdFrom: '報告作成日時の開始',
    createdTo: '報告作成日時の終了',
    updatedFrom: '報告更新日時の開始',
    updatedTo: '報告更新日時の終了',
    sort: '並び順',
    applySearch: '検索条件を適用',
    resetFilters: 'フィルターをリセット',
    cachedError:
      '最新の報告キューを確認できませんでした。現在の一覧は保持されます。',
    error: '報告キューを読み込めませんでした。',
    retry: '報告キューを再確認',
    loading: '報告キューを読み込んでいます…',
    refreshing: '報告キューのページを更新しています…',
    emptyTitle: '報告がありません',
    emptyDescription: '現在の条件に一致する報告はありません。',
    tableScrollLabel: '問題報告一覧の横スクロール領域',
    tableCaption:
      '問題報告キュー一覧。状態、理由、問題、報告者、担当者、作成日時、更新日時、詳細の列があります。',
    sortCreated: '作成日時が新しい順で並べ替え',
    sortCreatedActive: '作成日時が新しい順です',
    sortUpdated: '更新日時が新しい順で並べ替え',
    sortUpdatedActive: '更新日時が新しい順です'
  },
  reportDetail: {
    advancedFilters: '詳細条件',
    dateHint: 'タイムゾーン付きISO日時（例: 2026-10-01T00:00:00Z）',
    applyFilters: 'フィルターを適用',
    previous: '前の一覧',
    next: '次の一覧',
    first: '最初の一覧へ',
    total: '全{{count}}件',
    rowInfo: '報告情報',
    back: '報告一覧へ',
    reasonHint: '最大1,000文字（Unicode文字単位）',
    restored:
      '同じ管理者と報告の版を確認し、処理理由の下書きを復元しました。内容を確認してから実行してください。',
    storageFailed:
      '下書きを保存できなかったため、本人確認へ移動しませんでした。入力をコピーして保管するか、再試行してください。',
    discard: '下書きを破棄',
    fresh: 'Googleで管理者本人確認',
    leaveTitle: '編集中の処理理由があります',
    stay: '編集を続ける',
    leave: '破棄して移動',
    pending: '処理が完了するまでお待ちください。',
    listDescription: '報告理由と状態を確認し、詳細から対応してください。',
    title: '問題報告の詳細',
    loading: '報告詳細を読み込んでいます…',
    error: '報告詳細を読み込めませんでした。',
    cachedError:
      '報告詳細の最新状態を確認できませんでした。現在の処理入力は保持されます。',
    retry: '報告詳細を再確認',
    description: '報告の説明',
    noDescription: '説明は入力されていません。',
    triageTitle: '分類を開始',
    triageDescription: '現在の管理者に割り当て、分類済み状態へ移行します。',
    triage: '報告の分類を開始',
    resolutionTitle: '最終処理',
    outcome: '処理結果',
    resolutionReason: '処理理由',
    remediationHint:
      '任意です。同じ問題の検証済み後続バージョンIDのみ指定できます。',
    remediationVersionId: '改善バージョンID',
    resolve: '最終処理を実行',
    resolved: '処理完了: {{outcome}}',
    statusChanged: '報告を{{status}}状態へ変更しました。',
    resolutionComplete: '報告を{{status}}として処理しました。',
    conflictRefreshFailed:
      '報告の最新状態を確認できませんでした。入力は保持されます。ネットワークを確認してもう一度お試しください。',
    conflictRefreshed:
      '報告の最新状態を反映しました。入力を確認してから操作をもう一度実行してください。',
    mutationError: '報告状態を変更できませんでした。',
    retryConflict: '報告の最新状態を読み込む',
    conflictTitle: '別の操作で報告状態が変更されました'
  },
  userReport: {
    list: {
      title: 'バグレポート',
      description:
        '学習者から届いた問題の報告とアプリの不具合報告です。受付済みを先に、新しい順で表示します。',
      invalidQuery: 'URLの検索条件が許可範囲外です。既定の条件を使用します。',
      status: '処理状態',
      kind: '種類',
      loading: '報告を読み込んでいます…',
      refreshing: '報告一覧を更新しています…',
      error: '報告一覧を読み込めませんでした。',
      cachedError:
        '最新の報告一覧を確認できませんでした。現在の一覧はそのまま残ります。',
      retry: '報告一覧を再確認',
      emptyTitle: '処理する報告はありません。',
      emptyDescription: '現在の条件に合う報告はありません。',
      details: '詳細を見る',
      columns: {
        statusKind: '状態・種類',
        content: '内容',
        locationTime: '発生場所・日時',
        link: '詳細を見る'
      }
    },
    detail: {
      back: 'バグレポート一覧',
      loading: '報告を読み込んでいます…',
      error: '報告を読み込めませんでした。',
      retry: '再読み込み',
      content: '報告内容',
      location: '発生場所',
      target: '対象の問題',
      reporter: '報告者',
      deletedReporter: '退会した会員',
      noteTitle: '内部メモ · 報告者には表示されません',
      process: '処理',
      reply: '報告者への返信',
      replyVisible: '報告者が「自分の報告」で確認します',
      note: '内部メモ',
      noteHint: '報告者には表示されません。',
      notePlaceholder: '任意入力',
      replyAndClose: '返信して完了',
      saveNote: 'メモのみ保存',
      close: '返信せずに完了',
      noNotification: 'アプリ通知・メールは送信しません。',
      replyRequired: '報告者への返信を入力してください。',
      sentReply: '送信した返信',
      repliedAt: '返信日時',
      closedAt: '完了日時',
      closedNotice: '完了した報告はこれ以上処理できません。',
      repliedClosed: '返信を送信して完了しました。',
      noteSaved: '内部メモを保存しました。',
      closed: '返信せずに完了しました。',
      conflict:
        '他の管理者が先にこの報告を変更しました。最新の内容を読み込んだので、確認してからもう一度処理してください。',
      link: '関連',
      newVersion: '対象の問題の新しいバージョンを作成',
      noteReplaced:
        'メモ欄を他の管理者が保存した最新のメモに置き換えました。自分のメモは下に別途残しています。',
      myDraft: '自分のメモ',
      restoreDraft: '自分のメモを戻す'
    },
    location: {
      question: '{{screen}} · {{ordinal}}問目',
      unknown: 'その他の画面（{{raw}}）',
      screens: {
        home: 'トップ画面',
        login: 'ログイン',
        dashboard: '学習ホーム',
        practiceSetup: '演習の設定',
        practiceSession: '問題演習',
        result: '結果画面',
        wrongNoteCenter: '復習',
        wrongNoteDetail: '解説を見る',
        bookmarks: 'ブックマーク',
        legal: '規約・ポリシー',
        accountData: 'アカウントデータ案内',
        support: 'サポート案内',
        forbidden: 'アクセス権限なし',
        page: 'その他の画面'
      }
    },
    statuses: {
      RECEIVED: '受付済み',
      ANSWERED: '返信済み',
      CLOSED: '完了'
    },
    kinds: {
      QUESTION: '問題の報告',
      APP_ERROR: 'アプリの不具合'
    }
  }
} as const satisfies LocaleCatalog<typeof koResources.admin>
