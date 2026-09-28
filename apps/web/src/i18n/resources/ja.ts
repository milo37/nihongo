import type { koResources } from '@/i18n/resources/ko'

type LocaleCatalog<T> = {
  [Key in keyof T]: T[Key] extends string ? string : LocaleCatalog<T[Key]>
}

export const jaResources = {
  common: {
    appName: 'JLPT Drill Note',
    tagline: '解いて、残して、もう一度',
    locale: {
      label: '言語',
      ko: '한국어',
      ja: '日本語'
    },
    loading: {
      content: 'コンテンツを読み込んでいます…',
      page: 'ページを読み込んでいます…',
      auth: 'ログイン状態を確認しています…',
      mockNotice: 'Mockアカウント情報を読み込んでいます…',
      processing: '処理中…'
    },
    actions: {
      retry: 'もう一度試す',
      close: '閉じる',
      closeDialog: 'ダイアログを閉じる',
      closeNotification: '通知を閉じる',
      goHome: 'ホームへ移動',
      goLogin: 'ログインへ移動',
      goRandomPractice: 'RANDOM学習へ移動',
      login: 'ログイン'
    },
    state: {
      requestFailed: 'リクエストを完了できませんでした'
    },
    required: '（必須）',
    pagination: {
      label: 'ページ移動',
      previous: '前へ',
      previousLabel: '前のページ',
      next: '次へ',
      nextLabel: '次のページ',
      pageLabel: '{{page}}ページ{{current}}',
      currentSuffix: '、現在のページ'
    },
    toast: {
      region: '通知',
      info: 'お知らせ',
      success: '完了',
      warning: '注意',
      danger: 'エラー'
    },
    footer: {
      originalContent:
        'すべてオリジナル問題を使用するポートフォリオプロジェクトです。',
      scope: '聴解と実際のJLPT過去問題は含まれません。'
    }
  },
  navigation: {
    skipToContent: '本文へスキップ',
    menuOpen: 'メニューを開く',
    menuClose: 'メニューを閉じる',
    primary: 'メインメニュー',
    practice: '問題演習',
    wrongNotes: '間違いノート',
    bookmarks: 'ブックマーク',
    dashboard: 'ダッシュボード',
    adminQuestions: '問題管理',
    login: 'ログイン',
    routeChanged: '{{route}}画面に移動しました。',
    documentTitle: '{{route}} | JLPT Drill Note',
    metaDescription:
      'JLPT N5からN1までの問題を解き、間違いを繰り返し学習するJLPT Drill Note',
    routes: {
      home: 'ホーム',
      login: 'ログイン',
      resetPassword: 'パスワード再設定',
      verifyEmail: 'メール認証',
      dashboard: '学習ダッシュボード',
      practiceSetup: '問題演習の設定',
      practiceSession: '問題演習',
      result: '学習結果',
      wrongNoteCenter: '間違い復習センター',
      wrongNoteHistory: '間違い履歴',
      wrongNoteDetail: '間違いの詳細',
      bookmarks: 'ブックマーク',
      adminQuestionNew: '問題登録',
      adminQuestionImport: '問題インポート',
      adminQuestionDetail: '問題詳細',
      adminQuestions: '問題管理',
      adminAudit: '管理者監査ログ',
      adminReportDetail: '問題報告の詳細',
      adminReports: '問題報告キュー',
      forbidden: 'アクセス権限なし',
      page: 'ページ'
    }
  },
  home: {
    eyebrow: 'JLPT N5–N1 · VOCABULARY / GRAMMAR / READING',
    hero: {
      titleLine1: '間違えた問題を',
      titleLine2: '最後まで解決する学習',
      description:
        '級と科目を選んですぐに問題を解きましょう。提出した間違いは自動で整理され、2回連続で正解するまで復習が続きます。',
      openSetup: '学習設定を開く',
      accountLogin: 'アカウントにログイン',
      myDashboard: '学習ダッシュボード'
    },
    quickDrill: {
      eyebrow: 'QUICK DRILL',
      title: '10問すぐに解く',
      defaultMode: 'デフォルト RANDOM',
      levelLegend: 'JLPTレベル',
      subjectLegend: '学習科目',
      start: '選択範囲で開始',
      error:
        'セッションを作成できませんでした。ネットワーク状態と選択条件を確認し、もう一度お試しください。',
      countNote: '問題が10問未満の場合は、用意された問題数だけ出題します。'
    },
    subjects: {
      vocabulary: {
        label: '文字・語彙',
        description: '漢字の読みと文脈語彙'
      },
      grammar: {
        label: '文法',
        description: '形式選択と文の組み立て'
      },
      reading: {
        label: '読解',
        description: '短文から情報検索まで'
      }
    },
    loop: {
      eyebrow: 'LEARNING LOOP',
      title: '問題を解く瞬間から復習までつながります',
      items: {
        wrongNote: {
          title: '自動間違いノート',
          description:
            '間違えた回数と復習状態を記録し、見直すべき問題を逃しません。'
        },
        weakness: {
          title: '弱点分析',
          description:
            '科目別正答率と繰り返した間違いから、次の学習方針を決めます。'
        },
        mastery: {
          title: '2回連続正解',
          description:
            '一度の偶然ではなく、2回連続で正解したときに解決済みへ切り替えます。'
        }
      }
    }
  },
  auth: {
    eyebrow: 'SECURE ACCESS',
    title: '学習アカウントで始めましょう',
    description: {
      mock: '現在はローカルMock認証モードです。以下のデモアカウントのログインのみ提供し、認証状態はローカルデモストレージにのみ保存されます。',
      real: 'メール認証を完了したアカウントでログインすると、間違いノートと学習履歴を安全に継続できます。認証情報はブラウザストレージではなく安全なCookieで管理されます。'
    },
    currentAccount: '現在のアカウント',
    logout: 'ログアウト',
    methodLabel: '認証方法',
    signIn: 'ログイン',
    signUp: '新規登録',
    forgotPassword: 'パスワードをお忘れですか？',
    fields: {
      name: '名前',
      email: 'メールアドレス',
      password: 'パスワード',
      newPassword: '新しいパスワード',
      targetLevel: '目標レベル'
    },
    hints: {
      password: '12文字以上で入力してください。',
      newPassword: '12文字以上128文字以下で入力してください。'
    },
    notices: {
      registration:
        '登録リクエストを完了しました。受信トレイでメール認証を完了してからログインしてください。',
      resetRequested:
        '登録の有無にかかわらずリクエストを受け付けました。アカウントが存在する場合は再設定リンクを送信します。'
    },
    errors: {
      request:
        '認証リクエストを処理できませんでした。入力内容とネットワーク状態を確認してください。',
      resetRequest:
        '再設定リクエストを処理できませんでした。しばらく後にもう一度お試しください。',
      temporary:
        '一時的なエラーが発生しました。しばらく後にもう一度お試しください。',
      resetUnsupported:
        'Mockモードではパスワード再設定を利用できません。real APIモードでもう一度お試しください。',
      resetExpired:
        'リンクの有効期限が切れたか、すでに使用されています。新しいリンクをリクエストしてください。',
      verifyUnsupported:
        'Mockモードではメール認証を利用できません。real APIモードでもう一度お試しください。',
      verifyExpired:
        'リンクの有効期限が切れたか、すでに使用されています。新しい認証メールをリクエストしてください。'
    },
    signUpAction: 'メール認証をリクエスト',
    reset: {
      title: 'パスワード再設定',
      description:
        'アカウントのメールアドレスを入力すると、1時間有効な再設定リンクを送信します。',
      requestAction: '再設定リンクをリクエスト',
      backToLogin: 'ログインに戻る',
      invalidTitle: '無効な再設定リンク',
      missingToken:
        '再設定トークンがありません。ログイン画面から新しいリンクをリクエストしてください。',
      successTitle: 'パスワードを変更しました',
      successDescription:
        '既存のログインセッションはすべて終了しました。新しいパスワードで再度ログインしてください。',
      formTitle: '新しいパスワードを設定',
      formDescription:
        '12文字以上128文字以下の新しいパスワードを入力してください。',
      submit: 'パスワードを変更'
    },
    verify: {
      invalidTitle: '無効なメール認証リンク',
      missingToken:
        '認証トークンがありません。ログイン画面から認証メールを再送信してください。',
      successTitle: 'メール認証が完了しました',
      successDescription:
        '登録したメールアドレスとパスワードでログインできます。',
      title: 'メールアドレスの確認',
      description:
        '下のボタンを押すとメールアドレスの認証が完了します。リンクを開くだけではアカウントの状態は変更されません。',
      submit: 'メールアドレスを認証'
    },
    guest: {
      eyebrow: 'GUEST',
      title: '登録せずにまず体験',
      descriptionMock:
        'ランダム演習と結果確認をすぐに始められます。ゲストの記録はアカウントに自動統合されず、間違いノートとブックマークはログイン後に利用できます。',
      descriptionReal:
        'RANDOM演習と結果確認をすぐに始められます。ログインすると、今後の間違いノートとすべての学習履歴を継続して確認できます。',
      loading: 'ゲストセッションを準備中…',
      continue: 'ゲストで続ける'
    },
    mockNotice: {
      title: 'Mockデモアカウント',
      limitation:
        '新規登録・メール認証・パスワード再設定は、VITE_API_MODE=realの実APIモードで確認してください。'
    },
    validation: {
      email: '有効なメールアドレスを入力してください。',
      nameRequired: '名前を入力してください。',
      nameMax: '名前は80文字以下で入力してください。',
      passwordMin: 'パスワードは12文字以上で入力してください。',
      passwordMax: 'パスワードは128文字以下で入力してください。',
      newPasswordMin: '新しいパスワードは12文字以上で入力してください。',
      newPasswordMax: '新しいパスワードは128文字以下で入力してください。'
    }
  },
  practice: {
    name: '問題演習'
  },
  result: {
    name: '学習結果'
  },
  dashboard: {
    name: '学習ダッシュボード'
  },
  wrongNote: {
    name: '間違いノート'
  },
  bookmark: {
    name: 'ブックマーク'
  },
  admin: {
    name: '管理者'
  },
  errors: {
    forbidden: {
      eyebrow: '403 · アクセス権限なし',
      title: 'このページを表示する権限がありません',
      description:
        '管理者アカウントが必要な画面です。デモ管理者でログインしてください。',
      action: 'ログイン選択へ移動'
    },
    notFound: {
      eyebrow: '404 · 見つかりません',
      title: '指定されたページはありません',
      description: 'URLを確認するか、ホームからやり直してください。'
    },
    route: {
      eyebrow: 'ページエラー',
      title: '画面を読み込めませんでした',
      fallback: '予期しないエラーが発生しました。'
    },
    authStatus: {
      title: 'ログイン状態を確認できません',
      description:
        'サーバーでログイン状態を確認できませんでした。保存済みのアカウント情報は権限判定に使用していません。'
    },
    banner: {
      offline: 'オフラインです。ネットワーク接続を確認してください。',
      restored:
        'ネットワーク接続の復旧を検出しました。必要なリクエストをもう一度お試しください。',
      generic:
        'リクエストを処理できませんでした。しばらく後にもう一度お試しください。',
      network: 'ネットワーク接続が不安定です。もう一度お試しください。',
      response: '応答形式が正しくありません。もう一度お試しください。',
      validation: '入力内容を確認し、もう一度お試しください。',
      server:
        'サーバーリクエストを処理できませんでした。しばらく後にもう一度お試しください。'
    }
  },
  a11y: {
    japaneseContent: '日本語学習コンテンツ'
  }
} as const satisfies LocaleCatalog<typeof koResources>
