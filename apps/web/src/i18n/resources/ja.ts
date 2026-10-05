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
    explanation: {
      languageLabel: '解説の言語',
      japaneseUnavailable: '日本語の解説がないため、韓国語の解説を表示します。'
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
    taxonomy: {
      subjects: {
        VOCABULARY: '文字・語彙',
        GRAMMAR: '文法',
        READING: '読解'
      },
      studyModes: {
        RANDOM: '通常練習',
        WRONG_NOTE: '間違い',
        WEAKNESS: '弱点練習',
        BOOKMARK: 'ブックマーク',
        DAILY_REVIEW: '今日の復習'
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
      wrongNoteStatuses: {
        NEW: '新しい間違い',
        REVIEWING: '復習中',
        AGAIN: 'もう一度学習',
        SOLVED: '解決済み'
      },
      availability: {
        AVAILABLE: '現在出題可能',
        ARCHIVED: 'アーカイブ済み'
      },
      roles: {
        GUEST: 'ゲスト',
        USER: '学習者',
        ADMIN: '管理者'
      }
    },
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
      originalContent: 'オリジナル問題で学習します。',
      scope: '聴解と実際のJLPT過去問題は含まれません。',
      release: '· {{release}}',
      informationLabel: 'サービス情報',
      terms: '利用条件',
      privacy: 'プライバシー',
      copyright: '著作権',
      deletion: 'アカウント削除',
      dataExport: 'データエクスポート',
      questionReport: '問題報告',
      contact: 'お問い合わせ'
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
      legal: '法的情報',
      accountData: 'アカウントデータ案内',
      support: 'サポート案内',
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
  operations: {
    pages: {
      legal: {
        eyebrow: 'LEGAL FOUNDATION',
        title: 'サービス利用とコンテンツの案内',
        description:
          '利用条件、個人情報処理の構造、オリジナルコンテンツの原則をまとめて確認できます。'
      },
      account: {
        eyebrow: 'ACCOUNT DATA FOUNDATION',
        title: 'アカウントと学習データ管理の案内',
        description:
          'アカウント削除とデータエクスポートの現在の対応範囲、および有効化前の制限を説明します。'
      },
      support: {
        eyebrow: 'SUPPORT FOUNDATION',
        title: '問題報告とお問い合わせの案内',
        description:
          '問題内容の誤りを報告する方法と、公式問い合わせ窓口の現在の状態を案内します。'
      }
    },
    foundation: {
      title: '未定項目がある運用前の構造案内',
      description:
        '未定: 実際のサービス運営者情報、管轄、施行日、保持・削除期間、公式連絡先、法務レビュー。この画面は韓国語・日本語の情報構造を検証するための草案であり、該当項目が確定するまでは最終的な法的告知ではありません。'
    },
    navigation: {
      label: 'サービス情報の目次',
      terms: '利用条件',
      privacy: 'プライバシー',
      copyright: '著作権',
      deletion: 'アカウント削除',
      dataExport: 'データエクスポート',
      questionReport: '問題報告',
      contact: 'お問い合わせ'
    },
    sections: {
      terms: {
        title: '利用条件',
        summary:
          'JLPT Drill NoteはN5–N1の語彙・文法・読解練習と間違い復習を提供する学習用プロジェクトです。',
        details:
          '決済、コミュニティ、聴解、実際の試験問題、合格保証機能は含みません。機能の可用性と運用責任の最終条件はサービス有効化前に別途確定する必要があります。',
        status: '運営主体・管轄・施行日と法務レビューはまだ確定していません。'
      },
      privacy: {
        title: 'プライバシー案内',
        summary:
          '選択した環境では、アカウント情報、学習セッション、回答、間違いノート、ブックマーク、問題報告情報が機能提供のために処理される場合があります。',
        details:
          '現在の観測契約では、回答・問題・自由記述の原文をログや分析イベントへ含めないよう制限しています。分析送信はprovider-disabledが既定で、リクエスト・キュー・保存を作成しません。実際の処理者、保存場所、法的根拠、保持・削除期間、第三者提供の有無は運用環境レジストリで確定する必要があります。',
        status:
          '外部処理者と保持期間が未確定のため、最終的なプライバシーポリシーとしては使用できません。'
      },
      copyright: {
        title: '著作権と問題の出典',
        summary:
          '収録問題と解説はこのプロジェクト向けに独自作成した例題であり、実際のJLPTや市販教材の問題を複製していません。',
        details:
          '侵害の可能性があるコンテンツを見つけた場合、問題報告機能を利用できます。正式な権利者通知手続きと担当者情報は運用有効化前に確定する必要があります。',
        status: '正式な権利者連絡先と通知処理責任者はまだ指定されていません。'
      },
      deletion: {
        title: 'アカウント削除',
        summary:
          'アカウント削除依頼は、認証済み利用者と正確なデータ範囲を確認した上で処理する必要があります。',
        details:
          '現在この構造画面は削除依頼を送信せず、完了したとも表示しません。運用用認証手順、保持例外、処理期限、結果通知経路が準備されるまでは、機密情報を任意の宛先へ送らないでください。',
        status: 'Productionの削除受付窓口と担当者はまだ有効化されていません。'
      },
      dataExport: {
        title: 'データエクスポート',
        summary:
          '学習者が自分のアカウント・学習データの写しを依頼できる手続きが必要です。',
        details:
          '現在この画面には実際のエクスポート処理やダウンロードリンクがありません。本人再確認、範囲、形式、有効期限、監査証跡が検証された後にのみ運用機能を有効化します。',
        status:
          'Productionの学習者データエクスポート機能はまだ有効化されていません。'
      },
      questionReport: {
        title: '問題報告',
        summary:
          '対応環境では、学習結果や間違い詳細画面から、問題内容・正解・解説・著作権に関する理由を報告できます。',
        details:
          '報告には問題識別情報、理由、任意の説明が含まれる場合があります。機能の表示は環境ごとに異なり、運用処理責任者・保持期間・応答基準が確定するまではProduction対応を約束しません。',
        status: '運用用報告ストアと分類・解決担当者はまだ確定していません。'
      },
      contact: {
        title: 'お問い合わせ',
        summary:
          'アカウント、プライバシー、権利者通知、一般サポートのための検証済み公式連絡経路が必要です。',
        details:
          '現在公開できる公式メール・住所・運営主体はありません。認証情報、パスワード、学習データの原文、その他の機密情報を未確認の経路へ送らないでください。',
        status:
          '公式サービス運営者と問い合わせ先はProduction有効化ゲートで確定する必要があります。'
      }
    }
  },
  home: {
    approved: {
      vocabulary: '語彙',
      title: '今日の日本語学習',
      description: '科目とレベルを選んで始めましょう。',
      selected: '選択した学習',
      maximum: '最大10問',
      loading: '読み込み中'
    },
    entry: {
      guestNoticeTitle: '未ログインの学習について',
      guestNotice:
        '開発用のサンプルデータで学習します。実際のアカウント記録とは別です。',
      demoLogin: 'デモアカウントでログイン',
      eyebrow: '今日の学習ノート',
      title: '少しずつ、苦手なところから。',
      description: '途中の学習を続けるか、今取り組む内容を選んで始めましょう。',
      loading: '続けられる学習を確認しています…',
      recommended: '次の一枚',
      recommendationError:
        'おすすめを確認できませんでした。再確認するか、別の学習を選んでください。',
      resumeError:
        '途中の学習を確認できませんでした。再確認するか、学習設定で確認してください。',
      retry: '再確認',
      subjectScope:
        'この形式の記録を参考にした科目単位の苦手学習です。他の形式も出題されることがあります。',
      noRecommendation:
        '今始められるおすすめがありません。別の学習を選んでください。',
      resumeEyebrow: '途中の一枚',
      position: '現在{{current}}番 · 実際の問題数{{total}}問',
      savedAt: 'サーバーへの最終保存 {{date}}',
      notSaved: '保存済みの回答はまだありません。',
      resume: '続きから解く',
      legacyUnavailable:
        'この端末で再開できる回答が見つかりません。学習設定で確認してください。',
      other: '別の学習を選ぶ',
      records: '学習記録'
    },
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
    name: '問題演習',
    setup: {
      eyebrow: 'PRACTICE SETUP',
      title: '今日解く問題を設定してください',
      description:
        '出題可能な問題が不足する場合は、用意できる数だけを提供し、実際の問題数をお知らせします。',
      currentRole: '現在のロール: {{role}}',
      resume: {
        title: '続きから解く',
        description: '最近保存した学習から再開できます。',
        refreshing: '一覧を更新中…',
        guestHint:
          '新しいゲストセッションを始めると、このタブでサーバーの下書きから再開できます。ログインすると、別の端末でも同じアカウントの下書きを確認できます。',
        loading: '保存済みの下書きを確認しています…',
        offline:
          'オフラインです。接続が戻ると再開セッションの一覧を自動で再確認します。',
        cachedOffline:
          'オフラインのため、最後に確認した一覧を表示します。接続が戻るまでキャンセルとページ移動はできません。',
        stale:
          '最新の再開セッション一覧に更新できませんでした。最後に確認した一覧を保持します。',
        error: '再開できる一覧を読み込めませんでした。',
        empty:
          '保存された進行中の下書きはありません。下から新しい学習を始めてください。',
        summary:
          '実際の問題数{{formattedCount}}問 · 現在{{formattedOrdinal}}番',
        lastSaved: '最終保存 {{date}}',
        notSaved: 'まだサーバーに保存されていません',
        legacyUnavailable:
          'このセッションは別の端末のローカル回答を復元できません。新しい学習を始めるか、セッションをキャンセルしてください。',
        action: '続きから解く',
        cancel: 'セッションをキャンセル',
        paginationLabel: '再開セッションのページ'
      },
      steps: {
        level: '1. レベル',
        subject: '2. 科目',
        count: '3. 問題数',
        mode: '4. 出題モード'
      },
      questionCount: '{{formattedCount}}問',
      modes: {
        RANDOM: {
          label: 'ランダム問題',
          description: '選択したレベルと科目からランダムに出題します。'
        },
        WRONG_NOTE: {
          label: '間違えた問題',
          description: 'まだ解決していない間違いを優先して出題します。'
        },
        WEAKNESS: {
          label: '弱点おすすめ',
          description: '最近の提出で安定してよく間違えた問題を優先します。'
        },
        BOOKMARK: {
          label: 'ブックマーク',
          description: '保存した問題だけをまとめて解き直します。'
        },
        DAILY_REVIEW: {
          label: '今日の復習',
          description:
            'サーバーの予定に従い、今日復習する間違いを順番に解きます。'
        }
      },
      loginRequired: 'ログイン後に利用できます',
      protectedMode:
        '選択したモードはログイン後に利用できます。ランダム問題には変更していません。',
      login: 'ログイン',
      noEligibleTitle: '現在の条件では出題可能な{{mode}}がありません。',
      noEligibleDescription:
        'レベル・科目・モードを変更するか、ランダム問題を選んでください。サーバーが別のモードへ自動変更することはありません。',
      selectRandom: 'ランダム問題を選択',
      createError:
        'セッションを作成できませんでした。ネットワーク状態と選択条件を確認し、もう一度お試しください。',
      authorityNote:
        'サーバー管理の出題モードは候補が不足しても、別のモードへ自動変更しません。',
      start: '学習を開始',
      cancelDialog: {
        title: '進行中のセッションをキャンセルしますか？',
        description:
          'キャンセルするとサーバーの下書きが削除され、このセッションでは回答の保存や提出ができなくなります。',
        keep: 'そのまま保存',
        confirm: 'セッションをキャンセル',
        error:
          'セッションをキャンセルできませんでした。状態を更新してからもう一度お試しください。'
      }
    },
    session: {
      loading: {
        questions: '問題を準備しています…',
        guestOwnership: 'ゲストセッションの所有権を確認しています…',
        resultRedirect: '提出結果へ移動しています…',
        draft: 'サーバーの作業内容を確認しています…'
      },
      recovery: {
        title: '以前の提出結果を確認する必要があります',
        pendingDescription:
          '応答が失われた可能性があるため、このセッションから移動したり回答を変更したりできません。接続が戻るとセッション状態を自動で再確認します。',
        failedDescription:
          '応答が失われた可能性があるため、このセッションから移動したり回答を変更したりできません。ネットワークを確認してセッションを再読み込みし、同じ回答で続けてください。',
        retry: 'セッション状態を再確認',
        checkingStatus:
          'セッション状態を読み込んでいます。結果を確認するまでこの画面にとどまってください。',
        connectedStatus:
          'ネットワークに接続しています。セッション状態を再確認してください。'
      },
      errors: {
        sessionLoadTitle: '学習セッションを読み込めませんでした',
        sessionLoadDescription:
          'セッションのURLを確認するか、新しい学習を開始してください。',
        offlineSessionDescription:
          'オフラインです。接続が戻ると学習セッションを自動的に再確認します。',
        cachedOfflineDescription:
          'オフラインです。現在の問題と回答は保持しますが、接続が戻るまで変更や提出はできません。',
        staleSessionDescription:
          '学習セッションの最新状態を確認できませんでした。現在の問題と回答は保持し、再確認するまで変更や提出はできません。',
        retrySession: '学習セッションを再確認',
        draftLoadTitle: 'サーバーの作業内容を読み込めませんでした',
        draftLoadDescription:
          '安全に再開するため、最新の回答を確認する必要があります。接続を確認して再試行してください。',
        emptyTitle: '出題する問題がありません',
        emptyDescription: '別のレベル、科目、出題モードを選んでください。'
      },
      terminal: {
        expiredTitle: '期限切れの学習セッションです',
        cancelledTitle: 'キャンセルされた学習セッションです',
        description:
          '新しいRANDOM学習を開始してください。このセッションには回答を提出できません。',
        openSetup: '学習設定へ移動'
      },
      navigationGuard: {
        title: 'ひと休みしますか？',
        description:
          '今の回答と解答時間を保存して移動します。あとで続きから解けます。',
        continue: '続けて解く',
        saveAndLeave: '保存して移動'
      },
      header: {
        progressSummary:
          '現在{{current}}番 / 実際{{total}}問 · 回答済み{{answered}}問',
        elapsedTime: '経過時間'
      },
      draft: {
        status: {
          remoteDeferred:
            '別のタブの最新保存を検知しました。現在の保存応答を確認してから安全に統合します。',
          conflictPending:
            '別のタブの保存を検知しました。ローカル作業を保持したまま競合を確認します。',
          dirty: '変更内容をこのタブに一時保存しました。',
          saving: '変更内容をサーバーに保存しています。',
          savedAt: 'サーバーに保存しました。最終保存 {{time}}',
          saved: '回答をサーバーに保存しました。',
          offline:
            'オフラインです。変更内容はこの端末だけに一時保存し、接続後に再保存します。',
          conflict:
            '別の端末の変更と競合しました。サーバーまたはローカルの記録を選んでください。',
          error: '保存できませんでした。選んだ回答は保持され、再試行できます。',
          synced: 'サーバーに保存した回答と一致しています。'
        },
        conflictCheckPending:
          '最新のサーバー作業内容を確認している間、回答の保存と提出を一時停止します。',
        retry: '作業内容の保存を再試行',
        notices: {
          saveBeforeLeaveFailed:
            '作業内容を保存できなかったため、この画面にとどまります。',
          conflictRefreshComplete:
            '最新のサーバー作業内容を確認しました。競合項目を確認してから再提出してください。',
          sessionRefreshFailed: '最新のセッション状態を確認できませんでした。',
          submissionPreparationFailed:
            'サーバーの作業内容を保存できなかったため、提出しませんでした。',
          retrySaveFailed:
            '作業内容を再保存できませんでした。接続を確認してもう一度お試しください。'
        }
      },
      supply: {
        canonicalPartial:
          '指定した{{requested}}問のうち、{{mode}}モードで出題可能な{{actual}}問だけを提供します。別のモードには変更していません。',
        legacyFallback:
          'レガシーセッションでは選んだモードの問題が不足したため、ランダム問題も含めています。',
        canonicalNoFallback: '選択したモードは自動で変更しません。'
      },
      keyboardHelp: '解答のヒント',
      progressLabel: '回答済み {{percent}}%',
      question: {
        passageEyebrow: 'READING PASSAGE',
        passageLabel: '読解文',
        numberLabel: '{{ordinal}}番の問題。',
        answerLegend: '答えの選択肢',
        keyboardHint:
          '数字1〜4で回答を選び、← →キーで問題を移動し、最後の問題ではCtrl+⏎または⌘+⏎で提出確認を開けます。'
      },
      bookmark: {
        add: 'ブックマーク',
        remove: 'ブックマーク解除',
        addLabel: '{{ordinal}}番の問題をブックマークに追加',
        removeLabel: '{{ordinal}}番の問題のブックマークを解除',
        loginRequired: 'ブックマークに保存するにはログインしてください。',
        legacyReadOnly:
          '以前の契約セッションではブックマークを変更できません。',
        removed: 'ブックマークを解除しました。',
        removeRollback: 'ブックマークを解除できなかったため元に戻しました。',
        saved: 'ブックマークに保存しました。',
        saveRollback: 'ブックマークに保存できなかったため元に戻しました。',
        offlineQueued:
          'オフラインです。接続が戻るとブックマークの変更を再試行します。',
        statusLoadOffline:
          'オフラインのため、ブックマークの状態を確認できません。接続が戻ると自動的に再確認します。',
        statusLoadFailed: 'ブックマークの状態を確認できませんでした。',
        retryStatus: '再確認',
        chooseLogin: 'ログインを選ぶ'
      },
      navigation: {
        previous: '前へ',
        next: '次へ',
        submit: '回答を提出',
        jumpLabel: '問題へ移動',
        jumpQuestionAnswered: '{{ordinal}}番の問題、回答済み',
        jumpQuestionUnanswered: '{{ordinal}}番の問題、未回答'
      },
      submit: {
        title: '回答を提出しますか？',
        frozenDescription:
          '以前送信した回答をそのまま再提出します。結果を確認するまで回答は変更できません。',
        unansweredDescription:
          'まだ答えていない問題が{{unanswered}}問あります。未回答は不正解として扱われます。',
        completeDescription:
          'すべての問題に回答しました。提出後は回答を変更できません。',
        continue: '続けて解く',
        confirm: '提出して結果を見る',
        frozenFailure:
          '結果を確認できませんでした。ネットワークを確認して、同じ回答でもう一度お試しください。',
        requestFailure:
          '提出リクエストを処理できませんでした。入力とセッション状態を確認してもう一度お試しください。',
        connectivity: {
          offline:
            'オフラインです。接続が戻ると同じ回答でもう一度お試しください。',
          restored:
            'ネットワーク接続が戻りました。同じ回答でもう一度お試しいただけます。'
        }
      },
      conflict: {
        title: '別の端末の作業と競合しました',
        description:
          '{{conflicts}}件の変更内容が異なります。自動では上書きせず、選んだ記録を基準に続けます。',
        useServer: 'サーバーの記録を使用',
        keepLocal: '自分の変更を保持',
        detail:
          'サーバーに保存された回答を選ぶと、このタブの競合する変更は破棄されます。自分の変更を選ぶと、最新の回答に再保存します。'
      }
    }
  },
  result: {
    name: '学習結果',
    finish: '今日はここまで',
    reviewExplanations: '解説を確認する',
    outcomes:
      '正解{{correct}} · 選択した不正解{{wrong}} · 未回答{{unanswered}}',
    outcomesNote:
      '未回答も採点では不正解に含まれます。解説を確認し、必要なときに解き直しましょう。',
    loading: '採点結果を読み込んでいます…',
    error: {
      title: '学習結果を読み込めませんでした',
      description: 'ネットワークの状態を確認して、もう一度お試しください。',
      offlineTitle: 'オフラインで学習結果を待っています',
      offlineDescription:
        '接続が戻ると、学習結果とセッション状態を自動で再確認します。',
      cachedOffline:
        'オフラインのため、最後に確認した学習結果を表示します。接続が戻るまで結果に基づく操作はできません。',
      staleDescription:
        '最新の結果に更新できなかったため、最後に確認した結果を表示します。再確認するまで結果に基づく操作はできません。'
    },
    notFound: {
      title: '学習結果が見つかりません',
      description: '未提出のセッション、または期限切れの学習記録です。',
      retrySourceDescription:
        '再出題する元の結果がないか、現在のアカウントではアクセスできません。'
    },
    newPractice: '新しい問題を解く',
    description: '正解と解説を確認し、間違えた問題を次の復習につなげましょう。',
    metrics: {
      total: '全体',
      correct: '正解',
      incorrect: '不正解',
      accuracy: '正答率',
      duration: '所要時間',
      durationValue: '{{minutes}}分{{seconds}}秒'
    },
    status: {
      guest:
        '現在のゲストセッションでは間違えた問題を解き直せますが、アカウントの間違いノートには保存されません。',
      savedWrongCount:
        '間違えた{{formattedCount}}問を間違いノートに反映しました。'
    },
    actions: {
      retryIncorrect: '間違えた問題だけ解き直す',
      loginChoice: 'ログインを選ぶ',
      openWrongNotes: '間違いノートを見る'
    },
    retry: {
      checking: '結果を確認中…',
      waitingConnection: '接続待ち…',
      creating: '再出題中…',
      noEligibleTitle: '現在解き直せる問題はありません',
      noEligibleDescription:
        '問題がアーカイブされたか、再出題できる固定バージョンが残っていません。',
      unsupported:
        'この結果形式では間違えた問題の再出題に対応していません。新しい問題で学習を続けてください。',
      allCorrectTitle: '解き直す問題はありません',
      allCorrectDescription:
        'すべて正解しました。新しい問題で学習を続けましょう。',
      offline:
        'オフラインです。接続が戻ると同じ再出題キーでリクエストを続けます。',
      errorTitle: '再出題セッションを作成できませんでした。',
      errorDescription:
        'ネットワークの状態を確認して、同じボタンでもう一度お試しください。',
      priorEnded:
        '以前作成した再出題セッションは終了済みです。もう一度押すと新しいセッションを作成します。',
      sourceRefreshing: '元の学習結果の現在の状態を再確認しています。'
    },
    items: {
      title: '問題別の結果',
      correct: '正解',
      incorrect: '不正解',
      ordinal: '{{formattedOrdinal}}番',
      selectedAnswer: '選んだ答え',
      unanswered: '未回答',
      correctAnswer: '正解',
      correctAnswerUnavailable: '正解情報なし',
      explanation: '解説'
    },
    bookmark: {
      offline: 'オフラインです。接続が戻るとブックマークの変更を再試行します。',
      loadOffline:
        'オフラインのため、ブックマークの状態を確認できません。接続が戻ると自動的に再確認します。',
      loadError: 'ブックマークの状態を確認できませんでした。',
      retry: '再確認',
      add: 'ブックマーク',
      addLabel: '{{formattedOrdinal}}番の問題をブックマークに追加',
      remove: 'ブックマーク解除',
      removeLabel: '{{formattedOrdinal}}番の問題のブックマークを解除',
      unavailable: 'この結果ではブックマークを変更できません。',
      removed: 'ブックマークを解除しました。',
      removeFailed: 'ブックマークを解除できなかったため元に戻しました。',
      saved: 'ブックマークに保存しました。',
      saveFailed: 'ブックマークに保存できなかったため元に戻しました。'
    },
    blocker: {
      title: '再出題リクエストを処理しています',
      description:
        '結果を確認した後、新しい学習セッションへ自動で移動します。しばらくこの画面にとどまってください。',
      stay: 'この画面にとどまる'
    }
  },
  dashboard: {
    name: '学習ダッシュボード',
    loading: '学習ダッシュボードを読み込んでいます…',
    offline: {
      title: 'オフラインでダッシュボードを待っています',
      description:
        '接続が戻ると、累計統計と最近のインサイトを自動で再読み込みします。'
    },
    eyebrow: 'DASHBOARD',
    title: '学習の流れを確認しましょう',
    greeting: '{{name}}さんの目標レベルは{{level}}です。',
    learnerFallback: '学習者',
    targetUnset: '未設定',
    basisNote: '累計値は全期間、直近7日の日付はUTCを基準にしています。',
    startToday: '今日の学習を開始',
    summary: {
      loading: '累計学習統計を読み込んでいます…',
      offlineTitle: 'オフラインで累計統計を待っています',
      offlineDescription: '接続が戻ると、累計学習統計を自動で再確認します。',
      staleTitle: '最新の累計統計に更新できませんでした',
      staleDescription: '画面には最後に確認した結果を保持しています。',
      cachedOffline:
        'オフラインのため、最後に確認した累計統計を表示します。接続が戻ると自動的に再確認します。',
      retry: '累計統計を再試行',
      errorTitle: '累計ダッシュボードを読み込めませんでした',
      errorDescription:
        '直近90日のインサイトは別に確認できます。累計統計のみ再度リクエストしてください。',
      emptyTitle: 'まだ学習記録がありません',
      emptyDescription:
        '最初の問題を解くと、正答率、弱い科目、直近7日の学習量がここに表示されます。',
      emptyAction: '最初の学習を開始',
      totalAnswered: '解答総数',
      correctRate: '全体正答率',
      wrongNotes: '累計の間違い',
      solvedWrongNotes: '解決した間違い',
      weakestSubject: '最も弱い科目',
      analysisPending: '分析待ち',
      questionUnit: '問',
      itemUnit: '件',
      subjectAccuracy: '科目別正答率',
      subjectAccuracyLabel: '{{subject}}の正答率',
      recentSevenDays: '直近7日の学習量',
      recentSevenDaysLabel: '直近7日の問題解答数',
      chartDescription:
        'グラフの数値と日付も示し、色や棒の高さだけに依存しません。',
      recentSessions: '最近の学習記録',
      recentSessionResult: '{{correct}}/{{total}}正解',
      sessionAccuracy: '正答率 {{rate}}%',
      noRecentSessions: '最近のセッションはありません。',
      repeatedWrong: '繰り返し間違えた問題',
      openReviewCenter: '復習センターで見る',
      wrongCount: '{{formattedCount}}回間違い',
      noRepeatedWrong: '繰り返し間違えた問題はありません。'
    },
    insights: {
      loading: '直近90日のインサイトを読み込んでいます…',
      offlineTitle: 'オフラインで最近のインサイトを待っています',
      offlineDescription:
        '接続が戻ると、直近90日の学習インサイトを自動で再確認します。',
      errorTitle: '学習インサイトを読み込めませんでした',
      errorDescription:
        '既存の累計統計はそのまま確認できます。直近90日の分析のみ再度リクエストしてください。',
      retry: '最近のインサイトを再試行',
      eyebrow: 'LAST 90 DAYS',
      title: '弱点と次の学習提案',
      window:
        '{{formattedDays}}日分 · 最低{{formattedAttempts}}回のサンプル · {{observedAt}}時点',
      ruleBased: 'ルールベースの提案',
      staleTitle: '最新のインサイトに更新できませんでした',
      staleDescription: '画面には最後に確認した結果を保持しています。',
      cachedOffline:
        'オフラインのため、最後に確認した提案を表示します。接続が戻るまで提案は実行できません。',
      recentAttempts: '最近の解答',
      recentAccuracy: '最近の正答率',
      averageTime: '平均解答時間',
      dueReview: '復習予定',
      repeatedWrong: '繰り返しの間違い',
      questionUnit: '問',
      byLevel: 'レベル別正答率',
      chartDescription: '棒と同じ数値を下の表でも確認できます。',
      chartLoading: 'レベル別正答率グラフを読み込んでいます…',
      levelTableLabel: '直近90日のレベル別正答率詳細表',
      levelTableTitle: 'レベル別の詳細値',
      subjectTableLabel: '直近90日の科目別正答率詳細表',
      subjectTableTitle: '科目別統計',
      detailsSummary: '種類・タグの詳細統計を見る',
      detailsLabel: '詳細統計の種類',
      questionType: '問題の種類',
      questionTypeTableLabel: '直近90日の問題種類別正答率詳細表',
      questionTypeTableTitle: '問題種類別統計',
      tag: 'タグ',
      tagTableLabel: '直近90日のタグ別正答率詳細表',
      tagTableTitle: 'タグ別統計',
      noTags: '観測されたタグはありません。',
      tagTruncated:
        '全{{formattedTotal}}タグのうち最大{{formattedLimit}}件を表示します。',
      emptyTitle: '直近90日の学習記録がありません',
      emptyDescription:
        '問題を解くと、レベル・科目・種類・タグ別の正確さと平均解答時間が表示されます。サンプルがない値は0%ではなく「サンプルなし」として区別します。',
      weaknesses: '分析された弱点',
      count: '{{formattedCount}}件',
      noWeaknessTitle: '分析基準を満たす弱点はありません',
      noWeaknessDescription:
        '同じ分類で最低{{formattedAttempts}}回のサンプルが蓄積され、間違いがある場合に弱点として表示します。',
      recommendations: '次の学習提案',
      actionLoading: 'おすすめ学習を準備中…',
      actionAriaLabel: '{{action}}: {{summary}}',
      table: {
        caption: '{{title}}の表',
        category: '区分',
        attempted: '解答',
        correct: '正解',
        accuracy: '正答率',
        averageTime: '平均時間',
        recent: '最近の学習',
        attemptCount: '{{formattedCount}}回'
      },
      projection: {
        noSample: 'サンプルなし',
        noLearningRecord: '学習記録なし',
        seconds: '{{value}}秒',
        weaknessDetail:
          '{{attempted}}回中{{incorrect}}回間違い · 正答率{{accuracy}} · 直近{{days}}日',
        weaknessScore: '弱点スコア {{score}}',
        targetedSummary: '繰り返し間違えた1問を集中復習',
        openSetupSummary: '練習条件の設定を開く',
        sessionSummary:
          '{{mode}} · {{level}} {{subject}} · {{formattedCount}}問',
        startMode: '{{mode}}を開始',
        startTargeted: 'この問題だけ復習',
        openSetup: '練習条件の設定を開く',
        recommendation: {
          DUE_REVIEW: {
            title: '今日の復習から始めましょう',
            reason:
              '{{level}} {{subject}}の復習予定が{{formattedCount}}問あります。最も早い予定時刻は{{date}}です。'
          },
          REPEATED_WRONG: {
            title: '繰り返し間違えた問題を確認しましょう',
            reasonPrefix: '「',
            reasonSuffix:
              '」を{{formattedCount}}回間違えました。最後に間違えたのは{{date}}です。'
          },
          RECENT_LOW_ACCURACY_TYPE: {
            title: '最近正答率が低い種類を練習しましょう',
            reason:
              '{{level}} {{subject}}の{{questionType}}で{{attempted}}回中{{incorrect}}回間違えました。正答率は{{accuracy}}です。'
          },
          STALE_WEAK_SUBJECT: {
            title: 'しばらく離れていた弱い科目を復習しましょう',
            reason:
              '{{level}} {{subject}}の最後の弱点根拠は{{days}}日前です。{{attempted}}回中{{incorrect}}回間違えました。'
          },
          TARGET_LEVEL_PRACTICE: {
            title: '目標レベルの次の問題を解きましょう',
            reason:
              '{{level}} {{subject}}の{{catalogCount}}問中{{nonRecentCount}}問は直近3セッション外にあり、優先して練習できます。'
          },
          PRACTICE_SETUP_TARGET: {
            title: 'まず目標レベルを設定してください',
            reason:
              '目標レベルを設定すると、現在公開中の問題から次の練習を提案します。'
          },
          PRACTICE_SETUP_CATALOG: {
            title: '練習条件を選び直してください',
            reason:
              '現在の目標レベルには公開中の問題がないため、別のレベルや科目を選ぶ必要があります。'
          }
        },
        personalization: {
          NO_PERSONALIZED_EVIDENCE:
            '個別化の根拠がまだ十分でないため、目標レベルの一般練習も提案します。',
          TARGET_LEVEL_NOT_SET:
            '目標レベルがないため、練習条件の設定をご案内します。',
          NO_TARGET_CATALOG:
            '現在の目標レベルには公開中の問題がないため、練習条件の設定をご案内します。'
        }
      },
      actionNotice: {
        sessionExhausted:
          '提案後に出題可能な問題がなくなったため、この学習を開始できませんでした。指定モードは変更せず、最新の提案を確認しています。',
        sessionRefreshed: '指定モードは変更せず、最新の提案を確認しました。',
        sessionRefreshFailed:
          '指定モードは変更していません。最新の提案を読み込めなかったため、この提案を一時的に無効にしました。最近のインサイトを再試行してください。',
        sessionFailed:
          'おすすめ学習を開始できませんでした。別のモードには自動変更していません。同じ提案をもう一度お試しください。',
        targetedEnded:
          '以前作成した単独復習セッションは終了済みです。別の学習には変更せず、最新の提案を確認しています。',
        targetedEndedRefreshed:
          '終了した単独復習を別の学習に変更せず、最新の提案を確認しました。',
        targetedEndedRefreshFailed:
          '終了した単独復習を別の学習に変更していません。最新の提案を読み込めなかったため、この提案を一時的に無効にしました。最近のインサイトを再試行してください。',
        targetedUnavailable:
          '提案した問題は復習できなくなりました。別の学習には自動変更せず、最新の提案を確認しています。',
        targetedRefreshed:
          '別の学習には自動変更せず、最新の提案を確認しました。',
        targetedRefreshFailed:
          '別の学習には自動変更していません。最新の提案を読み込めなかったため、この提案を一時的に無効にしました。最近のインサイトを再試行してください。',
        targetedFailed:
          '単独復習を開始できませんでした。別の学習には自動変更していません。同じ提案をもう一度お試しください。'
      }
    }
  },
  wrongNote: {
    name: '間違いノート',
    history: {
      eyebrow: 'WRONG NOTE',
      title: 'すべての間違い記録',
      description:
        '最後に間違えた問題バージョンと当時の状態を保存する履歴アーカイブです。',
      backToCenter: '復習センターへ戻る',
      filters: {
        level: 'レベル',
        allLevels: 'すべてのレベル',
        subject: '科目',
        allSubjects: 'すべての科目',
        status: '状態',
        allStatuses: 'すべての状態',
        tag: 'タグ',
        allTags: 'すべてのタグ',
        sort: '並び順',
        recent: '最近の間違い順',
        mostWrong: '間違い回数順',
        oldest: '古い順'
      },
      states: {
        offline:
          'オフラインです。接続が戻ると現在のURL条件で全記録を自動的に再読み込みします。',
        loading: '間違いノートを読み込んでいます…',
        refreshing: '間違いノートのページを更新しています…',
        errorTitle: '間違いノートを読み込めませんでした',
        errorDescription: 'しばらく後にもう一度お試しください。',
        stale:
          '全記録の最新状態を確認できませんでした。現在までに読み込んだ記録は保持します。',
        retryStale: '全記録を再確認',
        correctingPage: '有効な間違いノートのページへ移動しています…',
        emptyTitle: '条件に合う間違いはまだありません',
        emptyDescription:
          '問題を解いて間違えた項目は自動的にここへ保存されます。',
        start: '最初の問題を解く'
      },
      results: {
        count: '間違い {{formattedCount}}件',
        resetFilters: 'フィルターをリセット',
        wrongCount: '{{formattedCount}}回間違い',
        questionType: '問題の種類',
        lastWrong: '最後の間違い',
        archived: 'アーカイブ済み · 解き直し不可',
        available: '現在出題可能 · 詳細から単独復習可能',
        detail: '詳細を見る'
      }
    },
    center: {
      eyebrow: 'REVIEW CENTER',
      title: '間違いノートの復習',
      description:
        '間違えた問題をもう一度解いて、身についた問題を解決済みにしましょう。',
      history: 'すべての間違い記録',
      views: {
        DUE: '復習予定',
        UNREVIEWED: '未復習',
        REPEATED: '繰り返しの間違い',
        SOLVED: '解決済み'
      },
      filters: {
        level: 'レベル',
        allLevels: 'すべてのレベル',
        subject: '科目',
        allSubjects: 'すべての科目',
        questionType: '問題の種類',
        allQuestionTypes: 'すべての種類',
        tag: 'タグ',
        allTags: 'すべてのタグ',
        sort: '並び順',
        more: '詳細フィルターを開く',
        less: '詳細フィルターを閉じる',
        active: '詳細条件 {{formattedCount}}件を適用中',
        nextReview: '次の復習順',
        mostWrong: '間違い回数順',
        recent: '最近の間違い順'
      },
      batch: {
        count: 'まとめる問題数',
        countOption: '{{formattedCount}}問',
        loading: '復習セッションを準備中…',
        start: '条件に合う今日の復習を開始',
        offline:
          'オフラインでは復習セッションを作成できません。接続後に同じ条件でもう一度お試しください。',
        noEligible: '現在の条件で出題可能な復習問題はありません。',
        error:
          '復習セッションを作成できませんでした。入力と接続状態を確認してください。'
      },
      states: {
        offline:
          'オフラインです。接続が戻ると現在のURL条件で復習キューを自動的に再読み込みします。',
        loading: '復習キューを読み込んでいます…',
        refreshing: '復習キューのページを更新しています…',
        errorTitle: '復習キューを読み込めませんでした',
        errorDescription: '接続状態を確認して、もう一度お試しください。',
        stale:
          '復習キューの最新状態を確認できませんでした。現在の結果は保持し、最新性を確認するまでまとめて復習を開始できません。',
        retryStale: '復習キューを再確認',
        correctingPage: '有効な復習キューのページへ移動しています…'
      },
      results: {
        count: '条件に合う間違い {{formattedCount}}件',
        observedAt: 'サーバー基準時刻 {{date}}',
        resetFilters: 'フィルターをリセット',
        dueEmptyTitle: '今予定されている復習はありません',
        filteredEmptyTitle: '条件に合う間違いはありません',
        dueEmptyDescription:
          '全記録を振り返るか、新しい問題を解いて次の復習を準備しましょう。',
        filteredEmptyDescription:
          'フィルターを変更するか、すべての間違い記録を確認してください。',
        history: 'すべての記録',
        setup: '学習設定',
        hasMemo: 'メモあり',
        wrong: '間違い',
        wrongCount: '{{formattedCount}}回',
        streak: '連続正解',
        nextReview: '次の復習',
        detail: '詳細・メモ・復習記録',
        pagination: '復習キューのページ'
      }
    },
    detail: {
      title: '最後に間違えた問題の詳細',
      snapshotNotice:
        '以下の問題・選択肢・解説は、最後に間違えた時点の問題バージョンです。',
      correct: '正解',
      explanation: '解説',
      review: {
        title: '復習記録',
        wrongCount: '間違えた回数',
        streak: '連続正解',
        count: '{{formattedCount}}回',
        lastWrong: '最近の間違い',
        nextReview: '次の復習',
        lastReview: '最近の復習',
        noRecord: '記録なし',
        archived: 'アーカイブ済み: 現在出題可能な問題バージョンがありません。',
        available: '現在出題可能な問題バージョンで単独復習を開始できます。'
      },
      states: {
        coldOfflineTitle: 'オフラインでは詳細を読み込めません',
        coldOfflineDescription:
          '接続が戻るとこの問題を自動的に再読み込みします。',
        loading: '間違いの詳細を読み込んでいます…',
        notFoundTitle: '間違い記録が見つかりません',
        notFoundDescription:
          '削除されたか、現在のアカウントに保存されていない問題です。',
        loadErrorTitle: '間違いの詳細を読み込めませんでした',
        loadErrorDescription:
          'ネットワークの状態を確認して、もう一度お試しください。',
        backHistory: 'すべての間違い記録へ戻る',
        backDashboard: '学習ダッシュボードへ戻る',
        backCenter: '復習センターへ戻る',
        cachedOffline:
          'オフラインです。保存済みの詳細を表示し、接続後にサーバー状態を再確認します。',
        stale:
          '詳細の最新状態を確認できませんでした。表示中の内容と編集中のメモは保持します。',
        retry: '詳細を再確認'
      },
      targeted: {
        waitingConnection: '接続待ち…',
        loading: '単独復習を準備中…',
        recover: '既存の単独復習を復元',
        start: 'この問題だけ解き直す',
        archivedRecovery:
          '問題はアーカイブ済みですが、以前作成した単独復習セッションは同じリクエストキーで復元できます。',
        memoDirty:
          'メモを保存するか変更を取り消してから単独復習を開始してください。',
        offline:
          'オフラインです。接続が戻ると同じリクエストキーで単独復習の作成を続けます。',
        unavailable: '現在出題可能な問題バージョンがありません。',
        error:
          '単独復習セッションを作成できませんでした。もう一度お試しください。',
        archivedOnly: 'アーカイブ済みの問題では記録とメモだけ確認できます。',
        endedArchived:
          '以前作成した単独復習セッションは終了済みです。アーカイブ済みの問題では新しい単独復習を開始できません。',
        endedAvailable:
          '以前作成した単独復習セッションは終了済みです。もう一度押すと新しいセッションを作成します。'
      },
      memoSection: {
        title: '自分のメモ',
        description:
          'メモは現在のアカウントのこの間違い記録にだけ保存され、自動保存はされません。'
      },
      timelineSection: {
        title: '復習タイムライン',
        description:
          '新しい記録から表示し、状態と回数の変化をテキストでも示します。'
      }
    },
    memo: {
      loadingOffline:
        'オフラインではメモを読み込めません。接続が戻ると自動的に再読み込みします。',
      loading: 'メモを読み込んでいます…',
      loadError: 'メモを読み込めませんでした。',
      cachedOffline:
        'オフラインです。保存済みのメモを表示し、接続後にサーバー状態を再確認します。',
      stale: 'メモの最新状態を確認できませんでした。編集中の入力は保持します。',
      retryStale: 'メモを再確認',
      label: '自分のメモ',
      hint: 'trim後のUnicode文字 {{current}}/{{maximum}}字 · メモは自動保存されません。',
      validation: {
        nul: 'NUL文字はメモに使用できません。',
        tooLong: 'メモは空白を除いて{{maximum}}字以内にしてください。',
        invalidUnicode: 'メモに正しくないUnicode文字があります。'
      },
      saveOffline:
        'オフラインではメモを保存できません。入力は保持されます。接続後にもう一度お試しください。',
      saveError:
        'メモを保存できませんでした。入力は保持されます。接続状態を確認してもう一度お試しください。',
      saved: 'メモを保存しました。',
      deleted: 'メモを削除しました。',
      cancelled: '変更を取り消しました。',
      saving: '保存中…',
      deleting: '削除中…',
      save: 'メモを保存',
      cancel: '変更を取り消す',
      delete: 'メモを削除',
      deleteDialog: {
        title: 'メモを削除しますか？',
        description:
          '保存済みのメモを完全に削除します。この操作は元に戻せません。',
        keep: 'メモを残す',
        confirm: 'メモを削除'
      },
      leaveDialog: {
        title: '保存していないメモがあります',
        description: 'このページを離れると編集中のメモが失われます。',
        continue: '編集を続ける',
        discard: '変更を破棄'
      }
    },
    timeline: {
      sources: {
        STUDY_SUBMIT: '通常学習の提出',
        WRONG_NOTE_REVIEW: '間違い復習の提出',
        VERSION_REBASE: '問題バージョンの切り替え'
      },
      outcomes: {
        none: '正誤判定なし',
        correct: '正解',
        incorrect: '不正解'
      },
      loadingOffline:
        'オフラインでは復習記録を読み込めません。接続が戻ると自動的に再読み込みします。',
      loading: '復習記録を読み込んでいます…',
      loadError: '復習記録を読み込めませんでした。',
      stale:
        '復習記録の最新状態を確認できませんでした。現在までに読み込んだ記録は保持します。',
      retryStale: '復習記録を再確認',
      emptyOffline: 'オフラインです。接続が戻ると復習記録を再確認します。',
      empty: '復習イベントはまだありません。',
      cachedOffline:
        'オフラインです。現在の記録を保持し、接続が戻ると中断したリクエストを続けます。',
      statusChange: '状態の変化',
      recordStart: '記録開始',
      wrongCount: '間違い回数',
      streak: '連続正解',
      elapsed: '解答時間',
      noRecord: '記録なし',
      seconds: '{{formattedCount}}秒',
      questionVersion: '問題バージョン',
      algorithm: 'アルゴリズム',
      algorithmVersion: 'version {{version}}',
      moreError:
        '以前の記録をさらに読み込めませんでした。現在までに読み込んだ記録は保持します。',
      waitingConnection: '接続待ち…',
      loadingMore: '以前の記録を読み込み中…',
      loadMore: '以前の記録をもっと見る',
      complete: '最初の間違い記録まですべて確認しました。'
    }
  },
  bookmark: {
    name: 'ブックマーク',
    loading: 'ブックマークを読み込んでいます…',
    error: {
      title: 'ブックマークを読み込めませんでした',
      description: 'しばらく後にもう一度お試しください。',
      offlineTitle: 'オフラインでブックマークを待機しています',
      offlineDescription:
        '接続が戻るとブックマーク一覧を自動的に再読み込みします。',
      cachedOffline:
        'オフラインです。現在の一覧を保持し、接続が戻ると中断したリクエストを続けます。',
      staleDescription:
        'ブックマークの最新状態を確認できませんでした。現在の一覧は保持します。'
    },
    status: {
      removing: 'ブックマークの解除を処理しています…',
      removed: 'ブックマークを解除しました。',
      restoreFailed:
        'ブックマークを解除できなかったため、以前の状態に戻しました。',
      offline: 'オフラインです。接続が戻るとブックマークの変更を再試行します。'
    },
    eyebrow: 'BOOKMARKS',
    title: 'ブックマークした問題',
    description:
      'もう一度確認したい問題をまとめ、BOOKMARKモードで学習できます。',
    empty: {
      firstTitle: '保存した問題はありません',
      pageTitle: 'このページは空です',
      firstDescription:
        '問題演習画面でブックマークすると、ここにまとめて表示されます。',
      pageDescription: '前のページでブックマークを確認してください。',
      start: '問題を解きに行く',
      previousPage: '前のページ'
    },
    practice: {
      title: '範囲別にブックマークを解き直す',
      description:
        '同じレベルと科目の現在公開中の問題を、保存した順に出題します。',
      groupAction: '{{level}} · {{subject}} · 最大{{formattedCount}}問を解く',
      allArchived:
        'このページのブックマークはすべてアーカイブ済みで、現在は出題できません。',
      noneAvailable:
        '選択した範囲には現在出題可能なブックマーク問題がありません。',
      refresh: 'ブックマーク一覧を更新',
      offline: 'オフラインです。接続が戻るとBOOKMARK学習の作成を再試行します。',
      startError:
        'BOOKMARK学習を開始できませんでした。しばらく後にもう一度お試しください。'
    },
    availability: {
      available: '出題可能',
      archived: 'アーカイブ済み',
      archivedDescription:
        '公開が終了したため、新しい学習セッションには含まれません。'
    },
    remove: 'ブックマークを解除',
    removeDialog: {
      title: 'ブックマークを解除しますか？',
      description:
        'この問題はブックマーク一覧から削除されます。問題演習画面からもう一度保存できます。',
      cancel: 'ブックマークを残す',
      confirm: '解除を確定'
    },
    pagination: {
      label: 'ブックマークのページ',
      refreshing: 'ブックマークのページを更新しています…',
      status: '{{page}} / {{pageCount}}ページ'
    }
  },
  admin: {
    name: '管理者',
    common: {
      breadcrumbLabel: '現在位置',
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
        REPORT_COUNT_DESC: '報告が多い順'
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
        WITHDRAW: '承認を取り消す'
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
        DEVELOPMENT: '開発'
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
      duplicateQuestionContent: '同じ内容の問題がすでに存在します。',
      untrustedOrigin: '許可されていないリクエスト元です。',
      rateLimited: 'リクエストが多すぎます。',
      server: 'サーバーで管理者リクエストを処理できませんでした。',
      unavailable: '管理者機能を一時的に利用できません。',
      reportDuplicate: '同じ問題バージョンに処理中の報告があります。',
      importIdentityConflict:
        'インポート項目の識別子が既存データと競合しています。',
      importValidationFailed:
        'インポートの検証結果が現在のリクエストと一致しません。',
      reauthenticationFailed: '現在のパスワードが正しくありません。',
      fieldInvalid: 'この入力値を確認してください。'
    },
    freshAssurance: {
      title: '管理者本人確認',
      description:
        '{{reason}} パスワード確認後、操作ボタンをもう一度押す必要があります。',
      passwordLabel: '現在のパスワード',
      privacy:
        'パスワードは保存されず、元のコマンドに再利用されることもありません。',
      cancel: 'キャンセル',
      checkingSession: 'ログイン状態を確認しています…',
      retrySession: 'ログイン状態を再確認',
      checking: '確認しています…',
      confirm: '本人確認',
      complete:
        '本人確認が完了しました。元の操作は自動実行されていません。内容を確認してからもう一度実行してください。',
      recovered:
        '現在の管理者セッションを確認しました。パスワードを再入力して本人確認をやり直してください。',
      recoveryFailed:
        'ログイン状態を確認できませんでした。ローカル作業は保持されます。ログイン状態の確認をもう一度お試しください。',
      failed: '本人確認を完了できませんでした。',
      reasons: {
        BATCH_REVIEW: '一括レビュー依頼は慎重な確認が必要な管理者操作です。',
        EXPORT: '問題のエクスポートには機密性のある正解と解説が含まれます。',
        IMPORT_APPLY: 'インポートの適用は複数の問題を作成する管理者操作です。',
        QUESTION_APPROVE: '承認は慎重な確認が必要な管理者操作です。',
        QUESTION_ARCHIVE:
          '問題のアーカイブは慎重な確認が必要な管理者操作です。',
        QUESTION_PUBLISH: '公開は慎重な確認が必要な管理者操作です。',
        QUESTION_RETIRE: '公開終了は慎重な確認が必要な管理者操作です。',
        QUESTION_WITHDRAW: '承認取り消しは慎重な確認が必要な管理者操作です。',
        REPORT_RESOLUTION: '報告の最終処理は慎重な確認が必要な管理者操作です。'
      }
    },
    questionList: {
      eyebrow: 'ADMIN QUESTION CMS · TECHNICAL MODE',
      title: '問題管理',
      description:
        'TEST/DEVELOPMENT向けのバージョン・レビューワークフローです。実際の人によるレビューや本番公開を意味しません。',
      searchLabel: '問題文の先頭一致検索',
      searchPlaceholder: '検索語を入力',
      level: 'レベル',
      allLevels: 'すべてのレベル',
      questionType: '問題形式',
      allQuestionTypes: 'すべての問題形式',
      difficulty: '難易度',
      allDifficulties: 'すべての難易度',
      lifecycle: '問題ライフサイクル',
      allLifecycles: 'すべてのライフサイクル',
      subject: '科目',
      allSubjects: 'すべての科目',
      tagKey: 'タグキー',
      tagPlaceholder: '登録済みタグの検索キー',
      authorActorId: '作成者actor ID',
      reviewerActorId: 'レビュー担当actor ID',
      createdFrom: '作成日時の開始',
      createdTo: '作成日時の終了',
      updatedFrom: '更新日時の開始',
      updatedTo: '更新日時の終了',
      versionStatus: 'バージョン状態',
      allStatuses: 'すべての状態',
      sort: '並び順',
      applySearch: '検索条件を適用',
      resetFilters: 'フィルターをリセット',
      invalidQuery:
        'URLの検索条件が許容範囲外です。条件を修正するかリセットしてください。',
      selectionSummary:
        '{{selectedCount}}件選択中 · エクスポートは全状態から最大100件、一括レビューは有効な下書き・修正依頼のみ最大20件です。現在レビュー依頼可能: {{reviewableCount}}件',
      requestReview: '選択項目をレビュー依頼',
      requesting: '依頼しています…',
      export: '機密データをエクスポート',
      validating: '検証しています…',
      batchComplete: '{{formattedCount}}件の問題をすべてレビュー依頼しました。',
      exportStarted: '{{formattedCount}}件の問題のエクスポートを開始しました。',
      conflictRefreshFailed:
        '最新一覧を確認できませんでした。選択状態は保持されます。ネットワークを確認してもう一度お試しください。',
      conflictRefreshed:
        '問題の最新状態を反映しました。選択内容を確認してレビュー依頼をもう一度実行してください。',
      conflictTitle: '別の操作で問題バージョンが変更されました',
      actionFailedTitle: '操作を完了できませんでした',
      retryConflict: '問題一覧の最新版を読み込む',
      cachedError:
        '最新一覧を確認できませんでした。現在の一覧と選択状態は保持されます。',
      retryList: '一覧を再確認',
      loading: '管理者用の問題を読み込んでいます…',
      loadErrorTitle: '問題一覧を読み込めませんでした',
      emptyTitle: '表示する問題がありません',
      emptyDescription: '検索条件を変更するか、新しい問題を作成してください。',
      tableHelp: '表が画面より広い場合は横方向にスクロールできます。',
      tableRefreshing: ' 最新一覧を確認しています。',
      tableCaption:
        '管理者用問題一覧。選択、問題、分類、バージョン状態、解答・正答率、報告、作成日時、更新日時、詳細の列があります。',
      tableScrollLabel: '管理者用問題一覧の横スクロール領域',
      columns: {
        select: '選択',
        question: '問題',
        classification: '分類',
        status: '状態',
        attempts: '解答・正答率',
        reports: '報告',
        createdAt: '作成日時',
        updatedAt: '更新日時',
        details: '詳細'
      },
      sortLabels: {
        level: '分類をレベル昇順で並べ替え',
        levelActive: '分類はレベル昇順です',
        reports: '報告数が多い順で並べ替え',
        reportsActive: '報告数が多い順です',
        created: '作成日時が新しい順で並べ替え',
        createdActive: '作成日時が新しい順です',
        updated: '更新日時が新しい順で並べ替え',
        updatedActive: '更新日時が新しい順です'
      },
      selectQuestion: '{{question}}を選択',
      answerStats: '{{formattedCount}}回 · 正答率{{rate}}',
      noAccuracy: '{{formattedCount}}回 · 正答率なし',
      reportCount: '{{formattedCount}}件'
    },
    create: {
      eyebrow: 'CREATE DRAFT',
      title: '新しい問題の下書きを作成',
      description:
        '作成結果は必ず新しい下書きバージョンになります。フォームから公開状態を直接指定することはできません。',
      submit: '下書きを作成',
      error: '問題を作成できませんでした。'
    },
    editor: {
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
        '現在のrowVersionを基準に実行し、競合時には自動再試行しません。',
      cancel: 'キャンセル',
      execute: '明示的に実行',
      requiredReason: '理由',
      optionalReviewNote: 'レビューメモ（任意）',
      noteLimit: 'メモは{{formattedCount}}文字以下にしてください。',
      commandWarning:
        'この操作は学習者への表示と記録に影響する場合があります。結果を確認してから実行してください。',
      commandComplete: '{{command}}を完了しました。'
    },
    import: {
      eyebrow: 'ATOMIC IMPORT',
      title: '問題の下書きをインポート',
      description:
        '最初に書き込みなしで検証し、同一項目とvalidation digestに対してのみ全件を適用します。',
      fileLabel: 'JSONファイル',
      fileHint: '最大2 MiB · 最大100件 · UTF-8 strict JSON',
      readingFile: 'ファイルを安全に読み込んでいます…',
      fileSizeError: 'ファイルは1 byte以上2 MiB以下にしてください。',
      fileFormatError:
        'JSONキーの重複がなく、canonical import request形式のUTF-8 JSONファイルが必要です。',
      validate: '書き込みなしで検証',
      valid: '検証成功',
      invalid: '検証エラー',
      resultCount: '{{formattedCount}}件',
      apply: '同じ検証結果を一括適用',
      applied: '{{formattedCount}}件の下書きを一括作成しました。',
      error: 'インポート要求を処理できませんでした。',
      issueLabel: '{{code}} · 項目{{item}} · {{field}}'
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
      reason: '報告理由',
      details: '説明',
      descriptionRequired: '報告の説明を入力してください。',
      cancel: 'キャンセル',
      submit: '報告を送信',
      submitted: '問題の報告を受け付けました。',
      error: '問題の報告を受け付けられませんでした。',
      offline: 'オフラインです。入力した説明は保持されます。'
    },
    reportList: {
      eyebrow: 'QUESTION REPORTS · TECHNICAL MODE',
      title: '問題報告キュー',
      description:
        '一覧では報告の説明を表示しません。詳細画面でのみプレーンテキストとして確認します。',
      invalidQuery:
        'URLの報告検索条件が許容範囲外です。安全な初期条件を使用します。',
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
    }
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
        'サーバーでログイン状態を確認できませんでした。保存済みのアカウント情報は権限判定に使用していません。',
      offlineTitle: 'オフラインではログイン状態を確認できません',
      offlineDescription:
        '接続が復旧したらログイン状態を再確認します。保存済みのアカウント情報は権限判定に使用していません。'
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
