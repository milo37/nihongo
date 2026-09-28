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
    name: '問題演習',
    setup: {
      eyebrow: 'PRACTICE SETUP',
      title: '今日解く問題を設定してください',
      description:
        '出題可能な問題が不足する場合は、用意できる数だけを提供し、実際の問題数をお知らせします。',
      currentRole: '現在のロール: {{role}}',
      resume: {
        title: '続きから解く',
        description:
          'サーバーに保存された進行中のセッションを、最新の下書きから表示します。',
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
          '{{formattedCount}}問 · 現在{{formattedOrdinal}}番 · revision {{formattedRevision}}',
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
          '回答を画面に復元する前に、セッションの所有権と最新revisionを確認する必要があります。接続を確認してもう一度お試しください。',
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
        title: '作業内容を保存して移動しますか？',
        description:
          '現在の問題の回答と経過時間をサーバーに保存してから、指定した画面へ移動します。',
        continue: '続けて解く',
        saveAndLeave: '保存して移動'
      },
      header: {
        progressSummary:
          '現在{{current}}番 / 全{{total}}問 · 回答済み{{answered}}問',
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
          saved: 'サーバーと同期しました。',
          offline:
            'オフラインです。変更内容はこの端末だけに一時保存し、接続後に再保存します。',
          conflict:
            '別の端末の変更と競合しました。サーバーまたはローカルの記録を選んでください。',
          error: '保存できませんでした。選んだ回答は保持され、再試行できます。',
          synced: 'サーバーの作業内容と同期しています。'
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
        canonicalNoFallback:
          'サーバー権威セッションは別のモードに変更しません。'
      },
      progressLabel: '問題演習の進捗 {{percent}}%',
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
          'サーバーの記録を選ぶと、このタブの競合する変更を破棄します。自分の変更を選ぶと、最新revisionの上に再保存します。'
      }
    }
  },
  result: {
    name: '学習結果',
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
      title: '今復習する問題を確認しましょう',
      description:
        'サーバーの復習予定と現在出題可能な問題バージョンを基準に並べます。',
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
    pagination: {
      label: 'ブックマークのページ',
      status: '{{page}} / {{pageCount}}ページ'
    }
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
