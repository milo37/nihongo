import type { koCoreResources } from './ko'

export type LocaleCatalog<T> = {
  [Key in keyof T]: T[Key] extends string ? string : LocaleCatalog<T[Key]>
}

export const jaCoreResources = {
  common: {
    appName: '하루마루',
    tagline: '解いて、間違えて、もう一度',
    locale: {
      label: '言語',
      ko: '한국어',
      ja: '日本語'
    },
    explanation: {
      languageLabel: '解説の言語',
      japaneseUnavailable:
        '日本語の解説がまだないので、韓国語の解説を表示します。'
    },
    loading: {
      content: '読み込み中…',
      page: '読み込み中…',
      auth: 'ログインを確認中…',
      processing: '少々お待ちください…'
    },
    actions: {
      goPractice: '学習画面へ',
      retry: 'もう一度試す',
      close: '閉じる',
      closeDialog: '閉じる',
      closeNotification: '通知を閉じる',
      goHome: '最初の画面へ',
      goLogin: 'ログインする',
      goRandomPractice: 'ランダムで解く',
      login: 'ログイン'
    },
    state: {
      accountRestricted:
        '今はこのアカウントの利用が一時的に制限されています。制限が解けると、また学習や報告ができます。',
      requestFailed: 'うまくいきませんでした'
    },
    required: '（必須）',
    taxonomy: {
      subjects: {
        VOCABULARY: '文字・語彙',
        GRAMMAR: '文法',
        READING: '読解'
      },
      studyModes: {
        RANDOM: 'ランダム',
        WRONG_NOTE: '間違えた問題',
        WEAKNESS: '苦手な問題',
        BOOKMARK: 'ブックマーク',
        DAILY_REVIEW: '復習する問題'
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
        AVAILABLE: '解ける',
        ARCHIVED: '今は解けない'
      },
      roles: {
        GUEST: 'ゲスト',
        USER: '会員',
        ADMIN: '管理者'
      }
    },
    pagination: {
      firstLabel: '最初のページ',
      lastLabel: '最後のページ',
      label: 'ページ',
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
      warning: '確認してください',
      loggedOut: 'ログアウトしました。',
      offline: 'インターネット接続が切れました。',
      restored: 'インターネットにまた接続しました。'
    },
    footer: {
      originalContent: '問題はすべて하루마루のオリジナルです。',
      scope: '聴解問題と実際のJLPT過去問はありません。',
      release: '· {{release}}',
      groups: {
        guidance: 'ご案内',
        help: 'ヘルプ',
        account: 'アカウント'
      },
      informationLabel: '하루마루について',
      terms: '利用規約',
      privacy: 'プライバシーポリシー',
      copyright: '著作権',
      questionReport: '問題を報告する',
      contact: 'お問い合わせ'
    }
  },
  navigation: {
    accountMenu: {
      label: 'アカウントメニュー',
      signedInWith: 'Googleアカウントでログイン中',
      myPage: 'マイページ',
      language: '言語',
      guestTitle: 'ログインしていません',
      guestDescription: 'ログインすると解いた記録が残ります'
    },
    account: 'アカウント',
    mobilePrimary: 'メニュー',

    skipToContent: '本文へスキップ',
    menuOpen: 'メニューを開く',
    menuClose: 'メニューを閉じる',
    primary: 'メニュー',
    learningStart: '学習',
    practice: '問題を解く',
    wrongNotes: '間違いノート',
    bookmarks: 'ブックマーク',
    my: 'マイページ',
    dashboard: '学習',
    adminQuestions: '問題管理',
    login: 'ログイン',
    routeChanged: '{{route}}の画面です。',
    documentTitle: '{{route}} | 하루마루',
    metaDescription:
      'JLPT N5〜N1の問題を解いて、間違えた問題はもう一度解いてみる하루마루',
    routes: {
      home: '学習',
      login: 'ログイン',
      dashboard: '学習',
      practiceSetup: '学習',
      practiceSession: '問題を解く',
      result: '結果',
      wrongNoteCenter: '間違いノート',
      wrongNoteHistory: '間違えた問題すべて',
      wrongNoteDetail: '解説',
      bookmarks: 'ブックマーク',
      legal: '規約・ポリシー',
      account: 'マイページ',
      accountData: '自分のデータ',
      support: 'ヘルプ',
      adminQuestionNew: '問題登録',
      adminQuestionImport: '問題インポート',
      adminQuestionDetail: '問題詳細',
      adminQuestions: '問題管理',
      adminAudit: '管理者監査ログ',
      adminReportDetail: 'バグレポートの詳細',
      adminReports: 'バグレポート',
      forbidden: '見られない画面',
      page: 'ページ'
    }
  },
  operations: {
    effectiveDate: '施行日：{{effectiveDate}}',
    settingFallback: {
      effectiveDate: '正式公開日',
      privacyOfficer: 'ハルマル運営者'
    },
    articleTitle: '第{{number}}条（{{title}}）',
    pages: {
      legal: {
        title: '利用案内',
        description:
          'ハルマルの利用規約、個人情報処理方針、問題の出典とお問い合わせ方法をご案内します。'
      },
      support: {
        title: '問題報告・お問い合わせの案内',
        description:
          '問題の報告方法と問い合わせ窓口の現在の状態を確認できます。'
      }
    },
    navigation: {
      label: 'サービス案内',
      terms: '利用条件',
      privacy: 'プライバシー',
      copyright: '著作権',
      questionReport: '問題報告',
      contact: 'お問い合わせ',
      tocLabel: 'このページの目次',
      legal: '利用案内',
      account: 'アカウント・データ',
      support: '報告・お問い合わせ'
    },
    sections: {
      terms: {
        title: '利用規約',
        summary:
          'ハルマル運営者（以下「運営者」）が提供するハルマルサービスの利用条件です。',
        articles: {
          '1': {
            title: '目的',
            body: '本規約は、運営者が提供する日本語JLPT学習サービス「ハルマル」（以下「本サービス」）の利用条件・手続きと、運営者および利用者の権利・義務を定めます。'
          },
          '2': {
            title: '定義',
            body: '①「会員」とは、Googleアカウントでログインした利用者です。②「非会員」とは、ログインせずに学習機能を利用する利用者です。③「コンテンツ」とは、本サービスが提供する問題・解説その他の資料です。'
          },
          '3': {
            title: '規約の掲示と変更',
            body: '①運営者は本規約を本サービスの画面に掲示します。②規約を変更する場合、施行の7日前から変更内容と施行日を画面で告知します。利用者に不利な変更は30日前から告知します。③変更後の規約に同意しない場合、利用を中止し退会できます。'
          },
          '4': {
            title: 'サービスの内容と変更・中止',
            body: '①本サービスは、N5〜N1の語彙・文法・読解の問題演習、間違いノート、ブックマーク、復習、学習統計を無料で提供します。②運営者は運営上・技術上必要な場合、本サービスの全部または一部を変更・中止でき、事前に画面で告知します。やむを得ない場合は事後に告知することがあります。'
          },
          '5': {
            title: '会員登録と退会',
            body: '①14歳以上の方は、Googleアカウントでログインして会員になれます。②会員はいつでもアカウント管理画面から退会できます。退会を申請すると直ちにログアウトされ利用が停止し、会員情報と学習記録は1時間以内に削除され、元に戻せません。'
          },
          '6': {
            title: '利用者の義務',
            body: '利用者は次の行為をしてはなりません。①他人のアカウントを利用する行為 ②本サービスの運営を妨げ、または自動化された方法で大量のリクエスト・収集を行う行為 ③コンテンツを個人学習以外の目的で複製・配布・販売する行為 ④報告に他人の個人情報や誹謗中傷を書く行為 ⑤法令または本規約に違反する行為'
          },
          '7': {
            title: '利用制限',
            body: '運営者は、会員が第6条に違反した場合、本サービスの利用を制限でき、制限した事実を画面で通知します。'
          },
          '8': {
            title: 'コンテンツと著作権',
            body: '①本サービスの問題と解説は運営者が独自に作成したもので、著作権は運営者に帰属します。実際のJLPT過去問や市販教材の問題は転載していません。②利用者はコンテンツを個人学習の範囲内でのみ利用できます。③利用者から寄せられた報告は、問題の修正とサービス改善に使用します。'
          },
          '9': {
            title: '公式サービスではないこと',
            body: '本サービスは日本語能力試験（JLPT）の実施機関とは関係のない、個人運営の学習サービスです。実際の試験問題は含まれておらず、合格を保証するものではありません。'
          },
          '10': {
            title: '責任の制限',
            body: '①運営者は、無料で提供する本サービスの利用に関し、運営者に故意または重大な過失がない限り、損害賠償の責任を負いません。②天災、外部サービス（ホスティング・Googleログイン）の障害など、運営者が管理できない事由により本サービスを提供できなかった場合、運営者は責任を負いません。③学習結果と統計は参考情報であり、実際の試験結果を予測するものではありません。'
          },
          '11': {
            title: '準拠法と管轄',
            body: '本規約は大韓民国の法律に準拠します。本サービスに関する紛争は、大韓民国の民事訴訟法に基づく管轄裁判所で解決します。'
          },
          '12': {
            title: '附則',
            body: '本規約は{{effectiveDate}}から施行します。'
          }
        }
      },
      privacy: {
        title: '個人情報処理方針',
        summary:
          'ハルマル運営者は、韓国「個人情報保護法」に基づき利用者の個人情報を保護し、関連する苦情を処理するため、本方針を定めます。',
        articles: {
          '1': {
            title: '処理の目的',
            body: '運営者は次の目的に限り個人情報を処理します。①会員の識別とログイン状態の維持 ②問題演習の記録、採点、間違いノート、ブックマーク、復習予定、学習統計の提供 ③問題報告の受付と処理 ④不正利用の防止とセキュリティ（リクエスト回数の制限、利用制限）'
          },
          '2': {
            title: '処理する項目',
            body: '①会員登録（Googleログイン）時にGoogleから受け取る情報：Googleアカウント識別子、メールアドレス、氏名 ②会員が任意で入力する情報：目標レベル ③利用中に生成される情報：学習セッション・回答・問題ごとの解答時間・結果、一時保存の回答、間違いノートとメモ、ブックマーク、復習予定、問題報告（場所、対象問題、理由、説明）とその回答 ④自動的に生成・収集される情報：ログインセッション情報（接続IPアドレス、ブラウザ情報、有効期限）、リクエスト回数制限のためにIPアドレスを復元できない形に変換した値、非会員学習用の識別値（サーバーには変換後の値のみ保存）⑤運営者は、パスワード、プロフィール写真、Googleのアクセストークン、電話番号、生年月日を保存しません。'
          },
          '3': {
            title: '保有期間',
            body: '①会員情報と学習記録：退会まで（退会申請後1時間以内に削除） ②問題報告の説明：処理（回答または終了）完了後180日 ③ログインセッション情報（接続IPアドレス、ブラウザ情報）：最終利用から7日（利用のたびに延長、最長30日）の経過またはログアウトで無効となります。記録はログアウトまたは退会まで保管し、その時点で削除します ④リクエスト回数制限の記録：制限時間の終了から7日 ⑤非会員の学習記録：最終利用から7日 ⑥一時保存の回答：提出・取消時に直ちに削除します。それ以外の会員の一時保存の回答は退会まで保管し、退会時に削除します。非会員の一時保存の回答は、⑤と同様に最終利用から7日の経過後に削除します ⑦サーバーログ：14日 ⑧データベースのバックアップ：最長30日。バックアップに残った情報はこの期間の経過後に自動的に削除されます（削除処理に1日程度かかる場合があります）。法令により別途保管すべき情報はありません。'
          },
          '4': {
            title: '破棄の手続きと方法',
            body: '保有期間の終了または処理目的の達成後、遅滞なく破棄します。電子ファイルはデータベースから復元できないよう削除し、報告の説明は削除済みの案内文に置き換えます。退会を申請すると直ちにすべてのログインセッションを削除して利用を停止し、1時間以内に会員情報（氏名、メールアドレス）、Googleアカウント識別子、学習記録（学習セッション、回答、結果、一時保存）、間違いノート・メモ、ブックマーク、復習記録、利用制限記録を削除します。バックアップとサーバーログに残った情報は、第3条の保管期間の経過後に削除されます。ただし、問題改善の履歴のため、次の情報は会員との紐付けを解除した形で残ります。①問題報告：対象問題・画面上の場所・理由・日時と運営者の回答のみ残り、説明は削除 ②退会処理の確認記録：変換後の受付番号、処理状態、ログイン方法の名称（google）、日時。'
          },
          '5': {
            title: '第三者提供',
            body: '運営者は個人情報を第三者に提供しません。法令に特別の定めがある場合を除きます。'
          },
          '6': {
            title: '処理の委託',
            body: '運営者はサービス運営のため、次の業務を委託しています。受託者：Amazon Web Services, Inc.／業務：サーバー、データベース、バックアップ、ログの保管／保管場所：大韓民国（ソウルリージョン）'
          },
          '7': {
            title: '国外移転',
            body: '運営者は個人情報を国外に移転して保管しません。Googleログインは、利用者がGoogleに直接ログインし、運営者はその結果としてGoogleアカウント識別子・メールアドレス・氏名のみを受け取ります。'
          },
          '8': {
            title: '情報主体の権利と行使方法',
            body: '①利用者はいつでも、自己の個人情報の閲覧・訂正・削除・処理停止を求めることができます。②会員退会（削除）はアカウント管理画面から直接行えます。Googleアカウント設定の「サードパーティ製アプリとの接続」に残るハルマルとの接続記録は運営者が削除できないため、Googleアカウント設定から直接解除してください。③その他のご要望は下記のお問い合わせメールにお送りいただければ、遅滞なく（遅くとも10日以内に）処理し、結果をお知らせします。④法定代理人または委任を受けた方を通じて求めることもできます。'
          },
          '9': {
            title: '安全性確保の措置',
            body: '①管理者権限は運営者1名のみに付与し、重要な操作の前に本人確認を再度求めます。②管理者の操作記録を残します。③すべての通信を暗号化（HTTPS）します。④データベースの保存装置とバックアップを暗号化し、秘密の設定値は暗号化された保管庫に置きます。⑤ログインCookieはスクリプトから読めない（HttpOnly）設定とし、非会員の識別値は変換後の値のみ保存します。⑥ログには回答・問題・報告の原文を残さないよう制限しています。'
          },
          '10': {
            title: 'Cookieと拒否方法',
            body: '①本サービスは、ログイン維持（セッション）、ログイン手続きの確認、非会員学習のために必要なCookieのみを使用します。広告・分析用Cookieは使用しません。②学習中の回答の写しや画面設定は、ブラウザのストレージ（localStorage）に保存することがあります。③ブラウザの設定でCookieを拒否・削除できます。拒否した場合、ログインと非会員学習は利用できません。'
          },
          '11': {
            title: '14歳未満の児童',
            body: '本サービスは14歳未満の児童の登録を受け付けません。14歳未満の方の情報が収集されたことが判明した場合は、直ちに削除します。'
          },
          '12': {
            title: 'センシティブ情報・仮名情報',
            body: '本サービスはセンシティブ情報および仮名情報を処理しません。'
          },
          '13': {
            title: '個人情報保護責任者',
            body: '個人情報保護責任者：{{privacyOfficer}}／連絡先：{{contactEmail}}'
          },
          '14': {
            title: '権益侵害の救済方法',
            body: '個人情報侵害に関する相談・申告は、次の機関に行うことができます（韓国）。個人情報紛争調停委員会 1833-6972、個人情報侵害申告センター 118、大検察庁 1301、警察庁 182'
          },
          '15': {
            title: '処理方針の変更',
            body: '本方針は{{effectiveDate}}から施行します。内容を変更する場合は、施行の7日前から本サービスの画面で告知し、以前の方針も引き続きこの画面で確認できるようにします。'
          }
        }
      },
      copyright: {
        title: '著作権と問題の出典',
        summary:
          '問題と解説はハルマル運営者が独自に作成した資料であり、実際のJLPT過去問や市販教材の問題は転載していません。',
        details:
          '権利侵害の疑いがある場合は、該当問題の「問題報告」を利用するか、お問い合わせメールでお知らせください。確認でき次第、該当問題を直ちに非公開にします。'
      },
      questionReport: {
        title: '問題内容の報告',
        summary:
          'ログインした会員は、報告に対応した学習結果または間違い詳細画面で該当問題を報告できます。',
        details:
          '該当問題の「問題報告」を開き、6つの理由から1つを選んで説明を入力します。説明は必須で、最大2,000文字です。この案内ページでは報告を受け付けません。',
        response:
          '報告は運営者が順番に確認し、問題の修正に使用します。処理期限は特に定めておらず、報告ごとの個別の回答はお送りしません。'
      },
      contact: {
        title: 'お問い合わせ',
        summary:
          'アカウント・個人情報・著作権に関するお問い合わせはメールで受け付けます：{{contactEmail}}',
        details:
          'お問い合わせの際は、パスワードや他人の個人情報を送らないでください。本人確認のため、ログインに使用しているGoogleのメールアドレスから送信してください。',
        contactUnset: 'お問い合わせメールは正式公開時にご案内します。'
      }
    }
  },
  home: {
    today: {
      memberGreeting: '{{name}}さん、今日も気軽に',
      memberGreetingNoName: '今日も気軽に',
      memberLead: '1セット10問で十分です。',
      guestGreeting: 'JLPTの問題を、1日10問ずつ気軽に',
      guestLead: 'N5からN1まで。会員登録なしですぐに解けます。',
      lastStudy: '前回の学習',
      firstStudy: 'はじめてなら',
      startTitle: '{{level}} {{subject}}',
      startMeta: '{{formattedCount}}問 · 約{{minutes}}分',
      startMember: 'すぐに解く',
      startGuest: 'ログインせずに解いてみる',
      change: '変更',
      changeLabel: 'レベルと科目を変更',
      dailyLabel: '今日の1問',
      dailyMeta: '{{level}} · {{subject}}',
      dailyOptionsLabel: '選択肢',
      dailyCorrect: '正解です',
      dailyIncorrect: '残念。正解は{{label}}番です',
      dailyYourAnswer: '自分の答え',
      dailyAnswer: '正解',
      dailyExplanation: '解説',
      dailyLoading: '今日の問題を読み込んでいます',
      dailyError: '今日の問題を読み込めませんでした。',
      dailyRetry: 'もう一度読み込む'
    },
    approved: {
      vocabulary: '文字・語彙',
      title: '今日も日本語をひとセット',
      description: 'レベルと科目を選ぶだけですぐ始められます。',
      selected: '選んだ学習',
      maximum: '最大10問',
      loading: '読み込み中…'
    },
    hero: {
      titleLine1: '間違えた問題は',
      titleLine2: '正解するまでもう一度',
      description:
        '級と科目を選んですぐに問題を解きましょう。提出した間違いは自動で整理され、2回連続で正解するまで復習が続きます。',
      openSetup: '学習を始める',
      accountLogin: 'ログイン',
      myDashboard: 'マイページ'
    },
    quickDrill: {
      title: '10問すぐ解く',
      defaultMode: 'ランダム出題',
      levelLegend: 'レベル',
      subjectLegend: '科目',
      start: '{{level}} {{subject}} {{formattedCount}}問を始める',
      error:
        '学習を始められませんでした。インターネット接続を確認して、もう一度お試しください。',
      countNote: '用意された問題が10問より少ないときは、ある分だけ出ます。'
    },
    subjects: {
      vocabulary: {
        label: '文字・語彙',
        description: '漢字の読み方、表記、合う言葉'
      },
      grammar: {
        label: '文法',
        description: '文法の選択、文の組み立て'
      },
      reading: {
        label: '読解',
        description: '短い文、案内文の読解'
      }
    },
    loop: {
      title: '解いたあとは復習まで続きます',
      items: {
        wrongNote: {
          title: '間違いノートに自動で入る',
          description: '間違えた問題と間違えた回数が自動で集まります。'
        },
        weakness: {
          title: '苦手を見つける',
          description:
            '科目別の正答率とよく間違える問題から、次に解くものをお知らせします。'
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
    guestGate: {
      title: 'ログインが必要です',
      bookmarks: 'ブックマークに入れた問題をまとめて見て、もう一度解けます。',
      review: '間違えた問題を集めてもう一度解けます。',
      wrongNote: '間違いノートはログインすると使えます。',
      dashboard: 'ログインすると解いた記録と正答率が見られます。',
      toStudy: '学習画面へ'
    },
    guestToast: {
      login: 'ログイン',
      bookmark: 'ブックマークはログインすると使えます。',
      sessionNotKept: '今解いている問題は、ログイン後には続きません。'
    },
    reauth: {
      name: '本人確認',
      description: '安全のため、Googleでもう一度ログインしてください。',
      go: 'Googleで確認する',
      redirecting: 'Googleに移動中…',
      returnNote: '確認が終わるとこの画面に戻ります。',
      scopeAccount: '退会の前には必ず本人確認をします。',
      stepDone: '完了',
      account: {
        returned: '本人確認が終わりました。最後にもう一度確認してください。',
        failed: '本人確認を完了できませんでした。もう一度お試しください。',
        cancelled: '本人確認を取り消しました。',
        wrongAccount:
          '登録したときのGoogleアカウントでもう一度お試しください。',
        invalid: '時間が過ぎたため確認が終わりました。もう一度お試しください。'
      }
    },
    sso: {
      checkingAccount: 'アカウントを確認中…',
      openAdminWork: '管理の作業が残っているため、今は退会できません。',
      title: 'ログイン',
      description:
        'Googleアカウントでログインすると、解いた記録がずっと残ります。',
      guestHint:
        'ログインしなくても1日{{total}}回、1回{{count}}問ずつ解けます。記録は残りません。',
      guestLink: 'ログインせずに解いてみる',
      checkingSession: 'ログインを確認中…',
      redirecting: '{{provider}}に移動中…',
      expired:
        '時間が過ぎたためログインが取り消されました。最初からやり直してください。',
      unavailable:
        '今はログインできません。しばらくしてからもう一度お試しください。',
      sessionExpired: 'ログインが切れました。もう一度ログインしてください。',
      migrationIncomplete:
        'ログイン方法を読み込めませんでした。学習記録はそのままです。',
      cancel: 'キャンセル',
      recheck: 'もう一度確認',
      logoutTitle: 'ログアウトしますか？',
      logoutDescription: 'ログアウトしても解いた記録はそのまま残ります。',
      logoutAction: 'ログアウト',
      loggingOut: 'ログアウト中…',
      logoutUnknown:
        'ログアウトできたか確認できませんでした。ページを再読み込みしてください。',
      unlinkTitle: '{{provider}}との連携を解除しますか？',
      unlinkDescription:
        '連携を解除した後は、連携済みの別のログイン方法でログインしてください。学習記録は維持されます。退会は別の操作です。',
      unlinkAction: '連携を解除',
      lastMethodTitle: '最後のログイン方法は解除できません。',
      deleteTitle: '退会しますか？',
      processing: '少々お待ちください…',
      actionFailed: 'うまくいきませんでした。もう一度お試しください。',
      deletionAccepted: '退会の申し込みを受け付けました。',
      deletionComplete:
        '退会しました。これまでご利用いただきありがとうございました。',
      unlinked: '連携を解除しました。',
      legacyMethod:
        'ログイン方法がGoogleに変わりました。Googleアカウントで続けてください。',
      continueGoogle: 'Googleで続ける',
      cancelledProvider:
        '{{provider}}のログインを取り消しました。もう一度試すか、ログインせずに解いてみることができます。',
      failedProvider:
        '{{provider}}でログインできませんでした。もう一度お試しください。',
      unavailableProvider:
        '今は{{provider}}でログインできません。しばらくしてからもう一度お試しください。',
      consentNotice:
        '続行すると、<terms>利用規約</terms>と<privacy>個人情報処理方針</privacy>を確認したものとみなします。14歳未満の方は登録できません。'
    }
  },
  practice: {
    name: '問題を解く',
    setup: {
      formTitle: '何を解きますか？',
      newTitle: '新しく解く',
      modeSummary: '出題方式',
      shortcutsLabel: 'もう一度解く',
      guestHint:
        'ログインしなくても1日{{total}}回、1回{{count}}問ずつ解けます。',
      reviewShortcut: '間違えた問題をもう一度解く',
      bookmarkShortcut: 'ブックマーク',
      title: '学習',
      description:
        '用意された問題が選んだ数より少ないときは、ある分だけ出ます。',
      resume: {
        title: '続きから解く',
        otherTitle: 'ほかの解きかけの学習',
        otherAction: 'もっと見る',
        description: '保存した答えは24時間残ります。',
        refreshing: '更新中…',
        loading: '解きかけの問題を探しています…',
        offline:
          'インターネット接続が切れました。つながったらもう一度読み込みます。',
        cachedOffline:
          'インターネット接続が切れたため、最後に読み込んだ一覧を表示しています。つながるまで、やめる操作とページ移動はできません。',
        stale: '一覧を更新できませんでした。最後に読み込んだ一覧です。',
        error: '解きかけの問題の一覧を読み込めませんでした。',
        empty: '解きかけの問題はありません。下から新しく始めてみてください。',
        summary: '{{formattedCount}}問中{{formattedOrdinal}}問目まで',
        lastSaved: '{{date}}に保存',
        notSaved: 'まだ解いた問題はありません',
        legacyUnavailable:
          'この学習はもう続けられません。新しく始めてください。',
        action: '続きから解く',
        cancel: 'やめる',
        paginationLabel: '解きかけの問題のページ'
      },
      steps: {
        level: 'レベル',
        subject: '科目',
        count: '問題数',
        mode: '出題方法'
      },
      questionCount: '{{formattedCount}}問',
      modes: {
        RANDOM: {
          label: 'ランダム',
          description: '選んだレベルと科目からランダムに出ます。'
        },
        WRONG_NOTE: {
          label: '間違えた問題',
          description: '復習する問題から出ます。'
        },
        WEAKNESS: {
          label: '苦手な問題',
          description: '最近よく間違える問題から出ます。'
        },
        BOOKMARK: {
          label: 'ブックマーク',
          description: 'ブックマークに入れた問題だけ出ます。'
        },
        DAILY_REVIEW: {
          label: '復習する問題を解く',
          description: '復習する問題を、前に間違えたものから10問出します。'
        }
      },
      guestResumeHint:
        'ログインすると、途中でやめた問題をあとで続きから解けます。',
      memberLocked: 'ログインすると使えます',
      locked: {
        count: '10問・20問はログインすると選べます。',
        mode: 'ランダム以外の出題方法はログインすると選べます。'
      },
      guestLeft: '今日は<b>{{total}}回中あと{{remaining}}回</b>です。',
      dailyLimit: {
        title: '今日の無料回数を使い切りました',
        description:
          'ログインすると回数の制限なく解けて、記録も残ります。ログインしない場合は、明日0時（日本時間）からまた{{total}}回解けます。'
      },
      urlLocked: '問題数と出題方法はログインすると選べます。',
      availableCountNote: '問題が足りないときは、ある分だけ出ます。',
      noEligibleTitle:
        '現在の条件では「{{mode}}」で出題できる問題がありません。',
      noEligibleDescription:
        'レベル・科目・出題方法を変えるか、ランダムで解いてみてください。',
      selectRandom: 'ランダムに変える',
      createError:
        '学習を始められませんでした。インターネット接続を確認して、もう一度お試しください。',
      authorityNote: '選んだ条件に合う問題だけ出ます。',
      start: '始める',
      cancelDialog: {
        title: '解きかけの問題をやめますか？',
        description: '保存した答えが消えて、続きから解けなくなります。',
        keep: 'そのままにする',
        confirm: 'やめる',
        error: 'やめられませんでした。もう一度お試しください。'
      }
    },
    session: {
      loading: {
        questions: '問題を準備しています…',
        guestOwnership: '問題を準備中…',
        resultRedirect: '結果に移動中…',
        draft: '保存した答えを読み込み中…'
      },
      recovery: {
        title: '採点結果を確認しています',
        pendingDescription:
          '提出した答えが採点されたか確認中のため、今は答えを変えたり画面を離れたりできません。インターネットにつながったらすぐ確認します。',
        failedDescription:
          '提出した答えが採点されたか確認できませんでした。インターネット接続を確認して［もう一度確認］を押してください。答えはそのまま残っています。',
        retry: 'もう一度確認',
        checkingStatus: '確認中です。この画面のまましばらくお待ちください。',
        connectedStatus:
          'インターネットにつながりました。［もう一度確認］を押してください。'
      },
      errors: {
        sessionLoadTitle: '問題を読み込めませんでした',
        sessionLoadDescription:
          'アドレスが正しいか確認するか、新しく始めてください。',
        offlineSessionDescription:
          'インターネット接続が切れました。つながったらもう一度読み込みます。',
        cachedOfflineDescription:
          'インターネット接続が切れました。今の画面はそのままですが、つながるまで答えの変更や提出はできません。',
        staleSessionDescription:
          '最新の状態を読み込めませんでした。解いた答えはそのままですが、もう一度確認するまで答えの変更や提出はできません。',
        retrySession: 'もう一度読み込む',
        draftLoadTitle: '保存した答えを読み込めませんでした',
        draftLoadDescription:
          '続きから解くには、まず保存した答えを読み込む必要があります。インターネット接続を確認して、もう一度お試しください。',
        emptyTitle: '解ける問題がありません',
        emptyDescription: 'レベル、科目、出題方法を変えてみてください。'
      },
      terminal: {
        notFoundTitle: 'この学習が見つかりません',
        notFoundDescription:
          'もう終わったか、開けない学習です。新しく始めてください。',
        retiredTitle: 'この学習は終わりました',
        retiredDescription: '続きからは解けません。新しく始めてください。',
        expiredTitle: '24時間が過ぎて終わった学習です',
        cancelledTitle: 'やめた学習です',
        description: 'この学習にはもう答えられません。新しく始めてください。',
        openSetup: '新しく始める'
      },
      exitGuest: {
        title: '解くのをやめますか？',
        description: '離れると、今解いた答えは保存されません。',
        keep: '解き続ける',
        leave: 'やめる'
      },
      header: {
        backToSetup: '学習画面へ',
        backToExplanation: '解説に戻る',

        progressSummary: '{{current}}/{{total}}問 · {{answered}}問回答'
      },
      draft: {
        retryShort: '再試行',
        inline: {
          reconciled:
            '別の場所で解いた答えを読み込みました。答えを確認してください。',
          saved: '自動保存しました',
          saving: '保存中…',
          error: '保存できませんでした',
          dirty: '保存待ち',
          offline: '接続なし · この端末にだけ保存中'
        },
        status: {
          reconciled:
            '別の場所で解いた答えを読み込みました。答えを確認してください。',
          remoteDeferred:
            'ほかのウィンドウでもこの問題を解いています。どちらの答えが新しいか確認しています。',
          conflictPending: '最新の答えを確認しています。',
          dirty: '変えた答えをこのウィンドウに一時的に残しました。',
          saving: '保存中…',
          savedAt: '{{time}}に保存しました。',
          saved: '保存しました。',
          offline:
            'インターネット接続が切れました。答えはこの端末に残しておき、つながったら保存します。',
          conflict: '最新の答えを確認しています。',
          error:
            '保存できませんでした。選んだ答えはそのままです。もう一度お試しください。',
          synced: 'すべて保存しました。'
        },
        conflictCheckPending:
          '最新の答えを確認する間、保存と提出を少し止めます。',
        retry: 'もう一度保存',
        notices: {
          saveBeforeLeaveFailed:
            '答えを保存できなかったので、画面を離れませんでした。',
          conflictRefreshComplete:
            '最新の答えを読み込みました。確認してからもう一度提出してください。',
          sessionRefreshFailed: '最新の状態を読み込めませんでした。',
          submissionPreparationFailed:
            '答えを保存できなかったので、提出しませんでした。',
          retrySaveFailed:
            'もう一度保存できませんでした。インターネット接続を確認してください。'
        }
      },
      supply: {
        canonicalPartial:
          '{{requested}}問を選びましたが、今解ける問題が{{actual}}問なので{{actual}}問だけ出ました。'
      },
      progressLabel: '{{percent}}% 回答',
      question: {
        passageBackToTop: '本文をもう一度見る',
        passageLabel: '文章',
        numberLabel: '{{ordinal}}番の問題。',
        answerLegend: '選択肢'
      },
      bookmark: {
        addLabel: '{{ordinal}}番の問題をブックマークに入れる',
        removeLabel: '{{ordinal}}番の問題をブックマークから外す',
        legacyReadOnly: 'この学習ではブックマークを変えられません。',
        removed: 'ブックマークから外しました。',
        removeRollback:
          'ブックマークから外せませんでした。もう一度お試しください。',
        saved: 'ブックマークに入れました。',
        saveRollback:
          'ブックマークに入れられませんでした。もう一度お試しください。',
        offlineQueued:
          'インターネット接続が切れました。つながったらブックマークに反映します。',
        statusLoadOffline:
          'インターネット接続が切れたため、ブックマークを確認できません。つながったらもう一度確認します。',
        statusLoadFailed: 'ブックマークを確認できませんでした。',
        retryStatus: '再確認'
      },
      navigation: {
        previous: '前へ',
        next: '次へ',
        submit: '提出する',
        jumpLabel: '問題番号',
        jumpQuestionAnswered: '{{ordinal}}番、回答済み',
        jumpQuestionUnanswered: '{{ordinal}}番、まだ解いていない'
      },
      submit: {
        title: '提出しますか？',
        frozenDescription:
          'さっき送った答えをそのままもう一度提出します。結果が出るまで答えは変えられません。',
        unansweredDescription:
          'まだ解いていない問題が{{unanswered}}問あります。解いていない問題は不正解として採点されます。',
        completeDescription:
          'すべての問題を解きました。提出すると答えは変えられません。',
        continue: '続けて解く',
        confirm: '提出して結果を見る',
        frozenFailure:
          '結果を受け取れませんでした。インターネット接続を確認して、もう一度お試しください。答えはそのままです。',
        requestFailure:
          '提出できませんでした。しばらくしてからもう一度お試しください。',
        connectivity: {
          offline:
            'インターネット接続が切れました。つながったらもう一度提出してください。',
          restored:
            'インターネットにまたつながりました。今もう一度提出できます。'
        }
      },
      conflict: {
        title: 'ほかの端末で解いた答えと違います',
        description:
          '{{conflicts}}問の答えが違います。どちらの答えを残すか選んでください。',
        useServer: '保存された答えを使う',
        keepLocal: 'この画面の答えを使う',
        detail:
          '「保存された答えを使う」を選ぶと、この画面で変えた答えは消えます。「この画面の答えを使う」を選ぶと、この画面の答えで保存します。'
      }
    }
  },
  result: {
    retired: {
      title: 'この結果はもう見られません',
      description: '新しく解いてみてください。'
    },
    navigation: {
      label: '問題番号',
      question: '{{formattedOrdinal}}番',
      emptyTitle: '見る問題がありません',
      emptyDescription: '学習画面で新しい問題を解いてみてください。'
    },
    name: '結果',
    summary: {
      score: '{{total}}問中 {{correct}}問正解',
      meta: '正答率 {{accuracy}} · {{duration}}'
    },
    grading: {
      checking: '採点しています',
      done: '採点結果',
      skipHint: 'タップするとすぐに見られます',
      showResult: '結果を見る'
    },
    nextActions: {
      title: '次にやること'
    },
    outcomesNote: '解いていない問題も不正解として採点されます。',
    loading: '採点結果を読み込み中…',
    error: {
      title: '結果を読み込めませんでした',
      description: 'インターネット接続を確認して、もう一度お試しください。',
      offlineTitle: 'インターネット接続が切れました',
      offlineDescription: 'つながったら結果をもう一度読み込みます。',
      cachedOffline:
        'インターネット接続が切れたため、最後に読み込んだ結果を表示しています。つながるまで解き直しはできません。',
      staleDescription:
        '最新の結果を読み込めなかったため、最後に読み込んだ結果を表示しています。もう一度読み込むまで解き直しはできません。'
    },
    notFound: {
      title: '結果が見つかりません',
      description: 'まだ提出していないか、期間が過ぎた学習です。',
      retrySourceDescription: '解き直す元の結果が見つかりません。'
    },
    newPractice: '新しい問題を解く',
    metrics: {
      accuracy: '正答率',
      durationValue: '{{minutes}}分{{seconds}}秒'
    },
    guestDone: '今日の無料回数を使い切りました。ログインすると続けて解けます。',
    memberLocked: 'ログインすると使えます',
    locked: {
      retry: '間違えた問題の解き直しは、ログインすると使えます。'
    },
    status: {
      guest:
        'ログインすると、間違えた問題が間違いノートに集まります。今の結果はログイン後には続きません。',
      savedWrongCount:
        '間違えた{{formattedCount}}問を間違いノートに入れました。'
    },
    actions: {
      retryIncorrect: '間違えた問題だけ解き直す',
      loginChoice: 'ログイン',
      nextSet: '次の{{formattedCount}}問',
      nextSetStarting: '新しい問題を準備しています…'
    },
    retry: {
      checking: '確認中…',
      waitingConnection: '接続を待っています…',
      creating: '準備中…',
      noEligibleTitle: '今解き直せる間違えた問題はありません',
      noEligibleDescription: '間違えた問題が今は解けない状態です。',
      unsupported:
        'この結果では間違えた問題だけを解き直すことはできません。新しい問題を解いてみてください。',
      offline:
        'インターネット接続が切れました。つながったらすぐ続けて準備します。',
      errorTitle: '解き直しを始められませんでした。',
      errorDescription:
        'インターネット接続を確認して、同じボタンをもう一度押してください。',
      priorEnded:
        '前に始めた解き直しは終わりました。もう一度押すと新しく始めます。',
      sourceRefreshing: '結果をもう一度確認しています。'
    },
    items: {
      title: '問題別の結果',
      correct: '正解',
      incorrect: '不正解',
      ordinal: '{{formattedOrdinal}}番',
      selectedAnswer: '自分の答え',
      unanswered: '未回答',
      correctAnswer: '正解',
      correctAnswerUnavailable: '正解を読み込めませんでした',
      explanation: '解説'
    },
    bookmark: {
      offline:
        'インターネット接続が切れました。つながったらブックマークに反映します。',
      loadOffline:
        'インターネット接続が切れたため、ブックマークを確認できません。つながったらもう一度確認します。',
      loadError: 'ブックマークを確認できませんでした。',
      retry: '再確認',
      add: 'ブックマーク',
      addLabel: '{{formattedOrdinal}}番の問題をブックマークに入れる',
      remove: 'ブックマークから外す',
      removeLabel: '{{formattedOrdinal}}番の問題をブックマークから外す',
      unavailable: 'この結果ではブックマークを変えられません。',
      removed: 'ブックマークから外しました。',
      removeFailed:
        'ブックマークから外せませんでした。もう一度お試しください。',
      saved: 'ブックマークに入れました。',
      saveFailed: 'ブックマークに入れられませんでした。もう一度お試しください。'
    },
    blocker: {
      title: '間違えた問題を解き直す準備をしています',
      description: '準備ができたらすぐ問題画面に進みます。少々お待ちください。',
      stay: '待つ'
    }
  },
  dashboard: {
    name: '自分の学習',
    loading: '読み込み中…',
    offline: {
      title: 'インターネット接続が切れました',
      description: 'つながったら学習記録をもう一度読み込みます。'
    },
    title: '自分の学習',
    greeting: '{{name}}さん、目標レベルは{{level}}',
    learnerFallback: '会員',
    targetUnset: 'まだ決めていません',
    basisNote: '全期間の記録です。',
    startToday: '今日の学習を始める',
    summary: {
      loading: '読み込み中…',
      offlineTitle: 'インターネット接続が切れました',
      offlineDescription: 'つながったらもう一度読み込みます。',
      staleTitle: '最新の記録を読み込めませんでした',
      staleDescription: '最後に読み込んだ記録を表示しています。',
      cachedOffline:
        'インターネット接続が切れたため、最後に読み込んだ記録を表示しています。つながったらもう一度読み込みます。',
      retry: 'もう一度読み込む',
      errorTitle: '学習記録を読み込めませんでした',
      errorDescription: '［もう一度読み込む］を押してください。',
      emptyTitle: 'まだ解いた問題がありません',
      emptyDescription: '問題を解くと、科目別の正答率がここに出ます。',
      emptyAction: '最初の問題を解く',
      totalAnswered: '解いた問題',
      correctRate: '正答率',
      wrongNotes: '間違えた問題',
      solvedWrongNotes: '解決した間違い',
      questionUnit: '問',
      itemUnit: '件',
      subjectAccuracy: '科目別正答率',
      subjectAccuracyLabel: '{{subject}}の正答率',
      recentSessions: '最近の学習',
      recentSessionResult: '{{total}}問中{{correct}}問正解',
      sessionAccuracy: '正答率 {{rate}}%',
      noRecentSessions: '最近解いた学習はありません。'
    }
  },
  wrongNote: {
    title: '間違いノート',
    rule: '間違えた問題はここに集まります。解き直して正解すると「復習した問題」に移ります。',
    levelLabel: '級',
    levelAll: 'すべて',
    start: '復習を始める',
    startEmpty: '復習する問題がありません。一覧を更新しました。',
    startError: '復習を始められませんでした。もう一度押してください。',
    loadError: '間違いノートを読み込めませんでした。',
    retry: '再読み込み',
    tabs: {
      toReview: '復習する問題 {{formattedCount}}',
      reviewed: '復習した問題 {{formattedCount}}'
    },
    card: {
      wrongCount: '{{count}}回まちがい',
      reviewedMeta: '{{date}}に正解'
    },
    empty: {
      levelNone: '{{level}}の問題はありません。',
      startNew: '新しい問題を解く',
      showAll: 'すべて見る',
      never: {
        title: 'まだ間違えた問題はありません',
        body: '問題を解いて間違えるとここに集まります。'
      },
      allDone: {
        title: '復習する問題をすべて解きました',
        body: 'ほかの問題でまた間違えると、ここに集まります。'
      },
      noReviewed: {
        title: 'まだ復習した問題はありません',
        body: '復習する問題を解き直して正解すると、ここに移ります。'
      }
    },
    integration: {
      title: '復習',
      range: '復習の範囲',
      views: {
        DUE: '今の復習',
        UNREVIEWED: 'まだ復習していない問題',
        REPEATED: '繰り返し間違えた問題',
        SOLVED: '解決した問題'
      },
      status: {
        TO_REVIEW: '復習する問題',
        REVIEWED: '復習した問題'
      },
      advanced: '詳細条件',
      applied: ' · 適用中',
      sort: {
        NEXT_REVIEW: '復習予定順',
        MOST_WRONG: '間違いが多い順',
        RECENT: '最近の間違い順'
      },
      reset: '条件をリセット',
      count: '{{formattedCount}}問',
      detail: '解説を見る',
      back: '復習一覧へ',
      start: '新しく学習する',
      versionChanged:
        '最後に間違えた時点の問題の解説です。解き直しには最新の問題を使います。',
      guest: {
        result: '今解いた結果'
      },
      empty: {
        title: 'まだ復習する問題はありません。',
        description: '学習中に間違えた問題はここで確認できます。'
      },
      filtered: {
        title: 'この条件に合う問題はありません。',
        description: '級や科目を変更してください。'
      },
      dueEmpty: {
        title: '今復習する問題はありません。',
        description: 'ほかの範囲の問題を確認できます。'
      },
      rangeEmpty: {
        title: 'この範囲に問題はありません。',
        description: 'ほかの復習範囲を選択してください。'
      },
      recent: {
        title: '最近の結果をもう一度見る',
        loading: '最近の結果を読み込み中…',
        error: '最近の結果を読み込めませんでした。',
        result: '結果・解説',
        limit: '最近終了した学習を最大5件確認できます。',
        empty: 'まだ終了した学習はありません。'
      },
      complete: {
        title: '復習の結果',
        correct: '正解です！',
        wrong: '残念、不正解です。',
        states: {
          REVIEWED: '正解したので「復習した問題」に移しました。',
          TO_REVIEW:
            'まだ「復習する問題」にあります。解説を読んでもう一度解いてみましょう。'
        },
        checking: '採点しました。間違いノートに反映しています。',
        unknown:
          '採点はできましたが、間違いノートへの反映を確認できませんでした。もう一度提出する必要はありません。',
        retryStatus: 'もう一度確認',
        current: '間違いノート',
        selected: '自分の答え',
        unanswered: '答えを選びませんでした。',
        unconfirmed: '確認できません'
      }
    },
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
          'インターネット接続が切れました。つながったらもう一度読み込みます。',
        loading: '読み込み中…',
        refreshing: '読み込み中…',
        errorTitle: '間違いノートを読み込めませんでした',
        errorDescription:
          'インターネット接続を確認して、もう一度お試しください。',
        stale:
          '最新の一覧を読み込めませんでした。もう一度読み込むまで復習は始められません。',
        retryStale: 'もう一度読み込む',
        correctingPage: 'あるページに移動中…'
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
        hasMemo: 'メモ',
        wrong: '間違い',
        wrongCount: '{{formattedCount}}回',
        streak: '連続正解',
        nextReview: '次の復習',
        detail: '詳細・メモ・復習記録',
        pagination: '間違いノートのページ'
      }
    },
    detail: {
      versionChanged: '問題が修正されました。解き直すと修正後の問題が出ます。',
      correctAnswer: '正解',
      noAnswer: '未選択',
      myAnswer: '自分の答え',
      back: '間違いノートへ',
      title: '最後に間違えた問題の詳細',
      snapshotNotice:
        '以下の問題・選択肢・解説は、最後に間違えた時点の問題バージョンです。',
      previousAnswer: {
        selected: '自分が選んだ答え',
        unanswered: '自分が選んだ答え：なし（未回答）',
        unavailable: '自分が選んだ答えを読み込めません',
        loading: '自分が選んだ答えを読み込み中…',
        error: '自分が選んだ答えを読み込めませんでした。',
        paused: 'インターネットにつながったら、自分が選んだ答えを読み込みます。'
      },
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
        archived: 'この問題は今は解けません。',
        available: '現在出題可能な問題バージョンで単独復習を開始できます。'
      },
      states: {
        coldOfflineTitle: 'インターネット接続が切れていて読み込めません',
        coldOfflineDescription: 'つながったらもう一度読み込みます。',
        loading: '読み込み中…',
        notFoundTitle: 'この問題が見つかりません',
        notFoundDescription: '消えたか、自分の間違いノートにない問題です。',
        loadErrorTitle: '読み込めませんでした',
        loadErrorDescription:
          'インターネット接続を確認して、もう一度お試しください。',
        backHistory: 'すべての間違い記録へ戻る',
        backDashboard: '学習ダッシュボードへ戻る',
        backCenter: '間違いノートへ',
        cachedOffline:
          'インターネット接続が切れました。保存された内容を表示し、つながったらもう一度確認します。',
        stale: '最新の内容を読み込めませんでした。表示中の内容はそのままです。',
        retry: 'もう一度読み込む'
      },
      targeted: {
        waitingConnection: '接続を待っています…',
        loading: '準備中…',
        recover: '解きかけの続きを解く',
        start: 'この問題をもう一度解く',
        archivedRecovery:
          'この問題は今は解けませんが、前に始めたものは続きから解けます。',
        offline:
          'インターネット接続が切れました。つながったらすぐ続けて準備します。',
        unavailable: 'この問題は今は解けません。',
        error: '解き直しを始められませんでした。もう一度押してください。',
        archivedOnly: '今は解けない問題なので、記録だけ見られます。',
        endedArchived:
          '前に始めた解き直しは終わりました。この問題は今は解けません。',
        endedAvailable:
          '前に始めた解き直しは終わりました。もう一度押すと新しく始めます。'
      },
      timelineSection: {
        title: '復習タイムライン',
        description:
          '新しい記録から表示し、状態と回数の変化をテキストでも示します。'
      }
    },
    memo: {
      title: '自分のメモ',
      privateHint: '自分だけが見られます',
      emptyLead:
        'なぜ間違えたかを一行残しておくと、復習のときすぐに思い出せます。',
      write: 'メモを書く',
      edit: '編集',
      delete: '削除',
      label: '自分のメモ',
      count: '{{current}} / {{maximum}}',
      over: '{{current}} / {{maximum}} · {{excess}}文字減らしてください',
      clearHint: 'メモを消すには「削除」を押してください。',
      cancel: 'キャンセル',
      save: '保存',
      retrySave: 'もう一度保存',
      saving: '保存中…',
      savedAt: '{{time}} 保存',
      saved: 'メモを保存しました。',
      deleted: 'メモを削除しました。',
      saveError:
        '保存できませんでした。入力した内容はそのまま残っています。接続を確認してもう一度保存してください。',
      saveOffline:
        'オフラインのため保存できませんでした。入力した内容はそのまま残っています。接続後にもう一度保存してください。',
      deleteError:
        '削除できませんでした。接続を確認してもう一度お試しください。',
      offline:
        'オフラインのため今は編集できません。接続後にもう一度お試しください。',
      loading: 'メモを読み込んでいます…',
      loadError: 'メモを読み込めませんでした。',
      loadOffline:
        'オフラインのためメモを読み込めません。接続が戻ると再読み込みします。',
      retryLoad: '再読み込み',
      deleteDialog: {
        title: 'メモを削除しますか？',
        description: '削除したメモは元に戻せません。',
        cancel: 'キャンセル',
        confirm: '削除',
        deleting: '削除中…'
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
    loading: '読み込み中…',
    error: {
      title: 'ブックマークを読み込めませんでした',
      description: 'しばらくしてからもう一度お試しください。',
      offlineTitle: 'インターネット接続が切れました',
      offlineDescription: 'つながったらブックマークをもう一度読み込みます。',
      cachedOffline:
        'インターネット接続が切れました。今の一覧はそのままにして、つながったら続けて読み込みます。',
      staleDescription:
        '最新の一覧を読み込めませんでした。今見えている一覧はそのままにします。'
    },
    status: {
      removing: '外しています…',
      removed: 'ブックマークから外しました。',
      restoreFailed:
        'ブックマークから外せませんでした。もう一度お試しください。',
      offline:
        'インターネット接続が切れました。つながったらブックマークに反映します。'
    },
    title: 'ブックマーク',
    listCount: '{{formattedCount}}問',
    sortSaved: '入れた順',
    savedOn: '{{date}}に入れた',
    description: 'もう一度見たい問題を集めておく場所です。',
    empty: {
      firstTitle: 'ブックマークに入れた問題はありません',
      pageTitle: 'このページには問題がありません',
      firstDescription:
        '問題を解くときにブックマークを押すと、ここに集まります。',
      pageDescription: '前のページを見てみてください。',
      start: '問題を解きに行く',
      previousPage: '前のページ'
    },
    practice: {
      title: 'ブックマークの問題を解く',
      description: 'レベル・科目ごとに、入れた順で出ます。',
      groupAction: '{{level}} {{subject}}を解く（最大{{formattedCount}}問）',
      allArchived: 'このページの問題は、どれも今は解けません。',
      noneAvailable: '今解けるブックマークの問題はありません。',
      refresh: '更新',
      offline:
        'インターネット接続が切れました。つながったらもう一度押してください。',
      startError:
        '始められませんでした。しばらくしてからもう一度お試しください。'
    },
    availability: {
      available: '解ける',
      archived: '今は解けない',
      archivedDescription: '修正中か取り下げた問題なので、出題されません。'
    },
    remove: 'ブックマークから外す',
    removeDialog: {
      title: 'ブックマークから外しますか？',
      description: '問題を解くときにまた入れられます。',
      cancel: 'そのままにする',
      confirm: '外す'
    },
    pagination: {
      label: 'ブックマークのページ',
      refreshing: '読み込み中…',
      status: '{{page}} / {{pageCount}}ページ'
    }
  },
  account: {
    targetLevel: {
      label: '目標レベル',
      hint: '練習はこのレベルから始まります。',
      unset: '未設定',
      saved: '目標レベルを変更しました。',
      error: '保存できませんでした。少し待ってからもう一度選んでください。'
    },
    title: 'マイページ',
    guestDescription:
      'ログインすると、学習記録とアカウントをここで見られます。',
    study: {
      title: '学習の記録',
      period: '全期間',
      total: '解いた問題',
      totalUnit: '問',
      rate: '正答率',
      wrongNotes: '間違えた問題',
      wrongSolved: '解決 {{solved}}・{{total}}件中',
      bySubject: '科目別の正答率',
      weakest: 'いちばん苦手な科目：{{subject}}',
      startSubject: '{{subject}}を解く',
      noRecord: '記録なし',
      week: '直近7日',
      recent: '最近の学習',
      repeated: 'よく間違える問題',
      wrongTimes: '{{count}}回間違い',
      seeInReview: '間違いノートで見る',
      fewData: '問題を解くほど正確になります。',
      emptyTitle: 'まだ解いた問題がありません',
      emptyDescription: '問題を解くと、科目別の正答率がここに表示されます。',
      emptyAction: '最初の問題を解く',
      error: '学習記録を読み込めませんでした。',
      retry: 'もう一度試す',
      loading: '読み込み中…'
    },
    settings: {
      title: 'アカウント',
      signInMethod: 'ログイン方法',
      connected: 'ログイン中',
      onlyMethod: '唯一のログイン方法のため、連携を解除できません。',
      logoutDescription:
        'この端末からログアウトします。学習記録はそのまま残ります。'
    },
    danger: {
      title: '退会',
      description:
        '退会するとすぐにログアウトされ、1時間以内に学習記録・間違いノート・メモ・ブックマーク・復習予定とアカウント情報が削除されます。元に戻すことはできません。\nGoogleアカウントは削除されません。',
      action: '退会する'
    },
    confirm: {
      stepDelete: '最終確認',
      stepUnlink: '連携解除の最終確認',
      deleteDescription: {
        scope:
          '退会するとすぐにログアウトされ、1時間以内に学習記録・間違いノート・メモ・ブックマーク・復習予定とアカウント情報（氏名・メールアドレス）が削除されます。元に戻すことはできません。',
        reports:
          'お送りいただいた問題報告は、説明を削除し、アカウントとの紐付けを解除した状態で残ります。',
        google:
          'Googleアカウントは削除されません。Googleアカウント設定の「サードパーティ製アプリとの接続」から、ハルマルとの接続を直接解除できます。'
      }
    },
    dataGuide: '自分のデータはどう扱われますか？',
    data: {
      description:
        'ログアウトすると、この端末からだけ出ます。退会すると、アカウントと学習記録が消えます。',
      privacyLink: 'プライバシーポリシーを見る',
      manageLink: 'マイページへ'
    }
  },
  errors: {
    forbidden: {
      memberDescription: 'このアカウントでは見られない画面です。',
      guestDescription: 'ログインすると見られます。',
      accountAction: 'ログインする',
      title: '見られない画面です',
      description: '運営者だけが見られる画面です。',
      action: '最初の画面へ'
    },
    notFound: {
      title: 'ないページです',
      description: 'アドレスを確認するか、最初の画面からやり直してください。'
    },
    route: {
      title: '画面を読み込めませんでした',
      fallback: '思わぬ問題が起きました。ページを再読み込みしてください。'
    },
    authStatus: {
      title: 'ログインを確認できませんでした',
      description: 'しばらくしてからもう一度お試しください。',
      offlineTitle: 'インターネット接続が切れました',
      offlineDescription: 'つながったらログインをもう一度確認します。'
    },
    banner: {
      generic:
        'うまくいきませんでした。しばらくしてからもう一度お試しください。',
      network: 'インターネット接続が不安定です。もう一度お試しください。',
      response: '問題が起きました。もう一度お試しください。',
      validation: '入力した内容を確認してください。',
      server: '問題が起きました。しばらくしてからもう一度お試しください。'
    }
  },
  a11y: {
    japaneseContent: '日本語の文'
  }
} as const satisfies LocaleCatalog<typeof koCoreResources>
