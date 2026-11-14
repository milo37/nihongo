import { questionTypeLabels } from './ko-question-types'

export const koCoreResources = {
  common: {
    appName: '하루마루',
    locale: {
      label: '언어',
      change: '언어 변경',
      ko: '한국어',
      ja: '日本語'
    },
    explanation: {
      languageLabel: '해설 언어',
      japaneseUnavailable:
        '일본어 해설이 아직 없어서 한국어 해설을 보여 드려요.'
    },
    loading: {
      content: '불러오는 중…',
      page: '불러오는 중…',
      auth: '로그인 확인 중…',
      processing: '잠시만요…'
    },
    actions: {
      goPractice: '학습 화면으로',
      retry: '다시 시도',
      close: '닫기',
      closeDialog: '창 닫기',
      closeNotification: '알림 닫기',
      goHome: '처음으로',
      goLogin: '로그인하기',
      goRandomPractice: '랜덤으로 풀기',
      login: '로그인'
    },
    state: {
      accountRestricted:
        '지금은 이용이 잠시 제한된 계정이에요. 제한이 풀리면 다시 학습하고 신고할 수 있어요.',
      requestFailed: '처리하지 못했어요'
    },
    required: '(필수)',
    taxonomy: {
      subjects: {
        VOCABULARY: '문자·어휘',
        GRAMMAR: '문법',
        READING: '독해'
      },
      studyModes: {
        RANDOM: '랜덤',
        WRONG_NOTE: '틀린 문제',
        WEAKNESS: '약한 문제',
        BOOKMARK: '책갈피',
        DAILY_REVIEW: '복습할 문제'
      },
      questionTypes: { ...questionTypeLabels }
    },
    pagination: {
      firstLabel: '첫 쪽',
      lastLabel: '마지막 쪽',
      label: '페이지',
      previous: '이전',
      previousLabel: '앞쪽',
      next: '다음',
      nextLabel: '다음 쪽',
      pageLabel: '{{page}}쪽{{current}}',
      currentSuffix: ', 지금 보는 쪽'
    },
    toast: {
      region: '알림',
      info: '안내',
      success: '완료',
      warning: '확인 필요',
      loggedOut: '로그아웃했어요.',
      offline: '인터넷 연결이 끊겼어요.',
      restored: '인터넷에 다시 연결됐어요.'
    },
    footer: {
      groups: {
        guidance: '이용 안내',
        help: '신고·문의',
        account: '계정·데이터'
      },
      informationLabel: '하루마루 안내'
    }
  },
  navigation: {
    accountMenu: {
      label: '계정 메뉴',
      signedInWith: 'Google 계정으로 로그인 중',
      myPage: '마이페이지'
    },
    account: '계정',
    mobilePrimary: '메뉴',

    skipToContent: '본문으로 건너뛰기',
    primary: '메뉴',
    learningStart: '학습',
    practice: '문제 풀기',
    wrongNotes: '오답노트',
    bookmarks: '책갈피',
    my: '마이',
    dashboard: '학습',
    login: '로그인',
    routeChanged: '{{route}} 화면이에요.',
    documentTitle: '{{route}} | 하루마루',
    metaDescription:
      'JLPT N5~N1 문제를 풀고, 틀린 문제는 다시 풀어 보는 하루마루',
    routes: {
      home: '홈',
      login: '로그인',
      dashboard: '홈',
      practiceSetup: '학습',
      practiceSession: '문제 풀기',
      result: '결과',
      wrongNoteCenter: '오답노트',
      wrongNoteHistory: '틀린 문제 전체',
      wrongNoteDetail: '해설',
      bookmarks: '책갈피',
      legal: '이용 안내',
      account: '마이페이지',
      accountData: '계정·데이터',
      support: '신고·문의',
      adminQuestionNew: '문제 등록',
      adminQuestionImport: '문제 가져오기',
      adminQuestionDetail: '문제 상세',
      adminQuestions: '문제 관리',
      adminAudit: '관리자 감사 기록',
      adminReportDetail: '버그 리포트 상세',
      adminReports: '버그 리포트',
      forbidden: '볼 수 없는 화면',
      page: '페이지'
    }
  },
  operations: {
    effectiveDate: '시행일: {{effectiveDate}}',
    settingFallback: {
      effectiveDate: '정식 공개일',
      privacyOfficer: '하루마루 운영자'
    },
    articleTitle: '제{{number}}조({{title}})',
    pages: {
      legal: {
        title: '이용 안내',
        description:
          '하루마루의 이용약관, 개인정보 처리방침, 문제 출처와 문의 방법을 안내합니다.'
      },
      support: {
        title: '문제 신고·문의 안내',
        description: '문제 내용 신고 방법과 문의 채널의 현재 상태를 확인하세요.'
      }
    },
    navigation: {
      label: '서비스 안내',
      terms: '이용 조건',
      privacy: '개인정보',
      copyright: '저작권',
      questionReport: '문제 신고',
      contact: '문의',
      tocLabel: '이 페이지 목차',
      legal: '이용 안내',
      account: '계정·데이터',
      support: '신고·문의'
    },
    sections: {
      terms: {
        title: '이용약관',
        summary:
          '하루마루 운영자(이하 "운영자")가 제공하는 하루마루 서비스의 이용 조건입니다.',
        articles: {
          '1': {
            title: '목적',
            body: '이 약관은 운영자가 제공하는 일본어 JLPT 학습 서비스 "하루마루"(이하 "서비스")의 이용 조건과 절차, 운영자와 이용자의 권리·의무를 정합니다.'
          },
          '2': {
            title: '정의',
            body: '① "회원"은 Google 계정으로 로그인한 이용자입니다. ② "비회원"은 로그인하지 않고 학습 기능을 이용하는 이용자입니다. ③ "콘텐츠"는 서비스에서 제공하는 문제, 해설과 그 밖의 자료입니다.'
          },
          '3': {
            title: '약관 게시와 변경',
            body: '① 운영자는 이 약관을 서비스 화면에 게시합니다. ② 약관을 바꿀 때는 시행 7일 전부터 서비스 화면에 바뀌는 내용과 시행일을 알립니다. 이용자에게 불리한 변경은 30일 전부터 알립니다. ③ 바뀐 약관에 동의하지 않으면 이용을 멈추고 탈퇴할 수 있습니다.'
          },
          '4': {
            title: '서비스 내용과 변경·중단',
            body: '① 서비스는 N5~N1 어휘·문법·독해 문제 풀이, 오답노트, 책갈피, 복습과 학습 통계를 무료로 제공합니다. ② 운영자는 운영상·기술상 필요하면 서비스의 전부 또는 일부를 바꾸거나 중단할 수 있으며, 미리 서비스 화면에 알립니다. 부득이한 경우에는 사후에 알릴 수 있습니다.'
          },
          '5': {
            title: '회원 가입과 탈퇴',
            body: '① 만 14세 이상인 사람은 Google 계정으로 로그인해 회원이 될 수 있습니다. ② 회원은 언제든지 계정 관리 화면에서 탈퇴할 수 있습니다. 탈퇴를 요청하면 바로 로그아웃되고 이용이 중지되며, 회원 정보와 학습 기록은 7일 뒤 삭제되어 되돌릴 수 없습니다. 7일 안에 다시 로그인하면 계정을 되살릴 수 있습니다. ③ 마지막으로 로그인한 날부터 1년 동안 로그인하지 않으면 탈퇴를 요청한 것으로 보고 ②와 같이 처리합니다(7일 뒤 삭제, 그 안에 다시 로그인하면 되살릴 수 있음).'
          },
          '6': {
            title: '이용자의 의무',
            body: '이용자는 다음 행위를 해서는 안 됩니다. ① 다른 사람의 계정을 이용하는 행위 ② 서비스 운영을 방해하거나 자동화된 방법으로 대량 요청·수집하는 행위 ③ 콘텐츠를 개인 학습 외의 목적으로 복제·배포·판매하는 행위 ④ 신고에 다른 사람의 개인정보나 비방을 적는 행위 ⑤ 법령이나 이 약관을 위반하는 행위'
          },
          '7': {
            title: '이용 제한',
            body: '운영자는 회원이 제6조를 위반하면 서비스 이용을 제한할 수 있으며, 제한 사실을 서비스 화면으로 알립니다.'
          },
          '8': {
            title: '콘텐츠와 저작권',
            body: '① 서비스의 문제와 해설은 운영자가 직접 만든 것이며 저작권은 운영자에게 있습니다. 실제 JLPT 기출문제나 상업 교재의 문항을 옮기지 않았습니다. ② 이용자는 콘텐츠를 개인 학습 목적 안에서만 이용할 수 있습니다. ③ 이용자가 보낸 신고는 문제를 고치고 서비스를 개선하는 데 쓰입니다.'
          },
          '9': {
            title: '공식 서비스가 아님',
            body: '서비스는 일본어능력시험(JLPT) 시행 기관과 관계없는 개인 운영 학습 서비스입니다. 실제 시험 문제를 포함하지 않으며 합격을 보장하지 않습니다.'
          },
          '10': {
            title: '책임의 제한',
            body: '① 운영자는 무료로 제공하는 서비스의 이용과 관련해 운영자의 고의 또는 중대한 과실이 없는 한 손해를 배상할 책임을 지지 않습니다. ② 운영자는 천재지변, 외부 서비스(호스팅·Google 로그인) 장애처럼 운영자가 통제할 수 없는 사유로 서비스를 제공하지 못한 경우 책임을 지지 않습니다. ③ 학습 결과와 통계는 참고용이며 실제 시험 결과를 예측하지 않습니다.'
          },
          '11': {
            title: '준거법과 관할',
            body: '이 약관은 대한민국 법에 따릅니다. 서비스와 관련한 분쟁은 민사소송법에 따른 관할 법원에서 해결합니다.'
          },
          '12': {
            title: '부칙',
            body: '이 약관은 {{effectiveDate}}부터 시행합니다.'
          }
        }
      },
      privacy: {
        title: '개인정보 처리방침',
        summary:
          '하루마루 운영자는 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고 관련 고충을 처리하기 위해 이 처리방침을 둡니다.',
        articles: {
          '1': {
            title: '처리 목적',
            body: '운영자는 다음 목적으로만 개인정보를 처리합니다. ① 회원 식별과 로그인 상태 유지 ② 문제 풀이 기록, 채점, 오답노트, 책갈피, 복습 일정, 학습 통계 제공 ③ 문제 신고의 접수와 처리 ④ 부정 이용 방지와 보안(요청 횟수 제한, 이용 제한)'
          },
          '2': {
            title: '처리하는 항목',
            body: '① 회원 가입(Google 로그인) 때 Google에서 받는 정보: Google 계정 식별자, 이메일 주소, 이름 ② 회원이 선택해 입력하는 정보: 목표 급수 ③ 서비스 이용 중 생성되는 정보: 학습 세션·답안·문제별 풀이 시간·결과, 임시 저장 답안, 오답노트와 메모, 책갈피, 복습 일정, 문제 신고(위치, 대상 문제, 사유, 설명)와 답변 ④ 자동으로 생성·수집되는 정보: 로그인 세션 정보(접속 IP 주소, 브라우저 정보, 만료 시각), 요청 횟수 제한을 위해 IP 주소를 복원할 수 없게 변환한 값, 비회원 학습용 식별값(서버에는 변환된 값만 저장) ⑤ 운영자는 비밀번호, 프로필 사진, Google 접근 토큰, 전화번호, 생년월일을 저장하지 않습니다.'
          },
          '3': {
            title: '보유 기간',
            body: '① 회원 정보와 학습 기록: 탈퇴할 때까지(탈퇴 요청 후 7일이 지나면 삭제, 그 안에 다시 로그인하면 복구 가능). 마지막으로 로그인한 날부터 1년 동안 로그인하지 않으면 탈퇴를 요청한 것으로 보고 같은 방식으로 삭제합니다(7일이 지나면 삭제, 그 안에 다시 로그인하면 복구 가능) ② 문제 신고 설명: 처리(답변 또는 종료)가 끝난 뒤 180일 ③ 로그인 세션 정보(접속 IP 주소, 브라우저 정보): 마지막 이용부터 7일(이용할 때마다 연장, 최대 30일)이 지나거나 로그아웃하면 효력이 없어집니다. 기록은 로그아웃하거나 탈퇴할 때까지 보관하고 그때 삭제합니다 ④ 요청 횟수 제한 기록: 제한 시간이 끝난 뒤 7일 ⑤ 비회원 학습 기록: 마지막 이용 후 7일 ⑥ 임시 저장 답안: 제출·취소하면 바로 삭제합니다. 그 밖의 회원 임시 저장 답안은 탈퇴할 때까지 보관하고 탈퇴 시 삭제하며, 비회원 임시 저장 답안은 ⑤와 같이 마지막 이용 후 7일이 지나면 삭제합니다 ⑦ 서버 로그: 30일 ⑧ 데이터베이스 백업: 최대 30일. 백업에 남은 정보는 이 기간이 지나면 자동으로 지워집니다(삭제 처리에 하루 정도 걸릴 수 있습니다). 법령에 따라 따로 보관해야 하는 정보는 없습니다.'
          },
          '4': {
            title: '파기 절차와 방법',
            body: '보유 기간이 끝나거나 처리 목적을 이루면 지체 없이 파기합니다. 전자 파일은 데이터베이스에서 복구할 수 없게 삭제하고, 신고 설명은 삭제 안내 문구로 바꿉니다. 탈퇴를 요청하면 즉시 모든 로그인 세션을 지우고 이용을 중지하며, 7일이 지나면 회원 정보(이름, 이메일), Google 계정 식별자, 학습 기록(학습 세션, 답안, 결과, 임시 저장), 오답노트·메모, 책갈피, 복습 기록, 이용 제한 기록을 삭제합니다. 그 7일 동안 다시 로그인해 계정을 되살리면 삭제하지 않습니다. 마지막으로 로그인한 날부터 1년 동안 로그인하지 않은 회원의 정보도 같은 범위로 삭제합니다. 백업과 서버 로그에 남은 정보는 제3조의 보관 기간이 지나면 지워집니다. 다만 문제 개선 이력을 위해 다음은 회원과의 연결을 끊은 형태로 남습니다. ① 문제 신고: 대상 문제·화면 위치·사유·시각과 운영자 답변만 남고 설명은 삭제 ② 탈퇴 처리 확인 기록: 변환된 접수 번호, 처리 상태, 로그인 방법 이름(google), 시각.'
          },
          '5': {
            title: '제3자 제공',
            body: '운영자는 개인정보를 제3자에게 제공하지 않습니다. 법령에 특별한 규정이 있는 경우만 예외입니다.'
          },
          '6': {
            title: '처리 위탁',
            body: '운영자는 서비스 운영을 위해 다음 업무를 맡깁니다. 수탁자: Amazon Web Services, Inc. / 업무: 서버, 데이터베이스, 백업, 로그 보관 / 보관 위치: 대한민국(서울 리전)'
          },
          '7': {
            title: '국외 이전',
            body: '운영자는 개인정보를 국외로 옮겨 보관하지 않습니다. Google 로그인은 이용자가 Google에 직접 로그인하고, 운영자는 그 결과로 Google 계정 식별자·이메일·이름만 받습니다.'
          },
          '8': {
            title: '정보주체의 권리와 행사 방법',
            body: "① 이용자는 언제든지 자기 개인정보의 열람, 정정, 삭제, 처리정지를 요구할 수 있습니다. ② 회원 탈퇴(삭제)는 계정 관리 화면에서 직접 할 수 있습니다. Google 계정 설정의 '타사 앱 연결'에 남는 하루마루 연결 기록은 운영자가 지울 수 없으므로 Google 계정 설정에서 직접 해제해 주세요. ③ 그 밖의 요구는 아래 문의 이메일로 보내 주시면 지체 없이(늦어도 10일 안에) 처리하고 결과를 알려 드립니다. ④ 법정대리인이나 위임받은 사람을 통해서도 요구할 수 있습니다."
          },
          '9': {
            title: '안전성 확보 조치',
            body: '① 관리자 권한은 운영자 1명에게만 주고 민감한 작업 전 본인 확인을 다시 요구합니다. ② 관리자 작업 기록을 남깁니다. ③ 모든 통신은 암호화(HTTPS)합니다. ④ 데이터베이스 저장 장치와 백업을 암호화하고, 비밀 설정값은 암호화된 저장소에 둡니다. ⑤ 로그인 쿠키는 스크립트가 읽을 수 없게(HttpOnly) 설정하고, 비회원 식별값은 변환된 값으로만 저장합니다. ⑥ 로그에는 답안·문제·신고 원문을 남기지 않도록 제한합니다.'
          },
          '10': {
            title: '쿠키와 거부 방법',
            body: '① 서비스는 로그인 유지(세션), 로그인 진행 확인, 비회원 학습을 위해 꼭 필요한 쿠키만 씁니다. 광고·분석 쿠키는 쓰지 않습니다. ② 학습 중인 답안 사본과 화면 설정은 브라우저 저장소(localStorage)에 보관할 수 있습니다. ③ 브라우저 설정에서 쿠키를 거부하거나 지울 수 있습니다. 거부하면 로그인과 비회원 학습을 이용할 수 없습니다.'
          },
          '11': {
            title: '만 14세 미만 아동',
            body: '서비스는 만 14세 미만 아동의 가입을 받지 않습니다. 만 14세 미만의 정보가 수집된 사실을 알게 되면 바로 삭제합니다.'
          },
          '12': {
            title: '민감정보·가명정보',
            body: '서비스는 민감정보와 가명정보를 처리하지 않습니다.'
          },
          '13': {
            title: '개인정보 보호책임자',
            body: '개인정보 보호책임자: {{privacyOfficer}} / 연락처: {{contactEmail}}'
          },
          '14': {
            title: '권익침해 구제 방법',
            body: '개인정보 침해에 대한 상담·신고는 다음 기관에 할 수 있습니다. 개인정보분쟁조정위원회 1833-6972, 개인정보침해신고센터 118, 대검찰청 1301, 경찰청 182'
          },
          '15': {
            title: '처리방침의 변경',
            body: '이 처리방침은 {{effectiveDate}}부터 시행합니다. 내용이 바뀌면 시행 7일 전부터 서비스 화면에 알리고, 이전 처리방침은 이 화면에서 계속 볼 수 있게 합니다.'
          }
        }
      },
      copyright: {
        title: '저작권과 문제 출처',
        summary:
          '문제와 해설은 하루마루 운영자가 직접 만든 자료이며, 실제 JLPT 기출문제나 상업 교재 문항을 옮기지 않았습니다.',
        details:
          "권리 침해가 의심되면 해당 문제의 '문제 신고'를 이용하거나 문의 이메일로 알려 주세요. 확인되면 해당 문제를 바로 내립니다."
      },
      questionReport: {
        title: '문제 내용 신고',
        summary:
          '로그인한 회원은 신고가 지원되는 학습 결과 또는 오답 상세 화면에서 해당 문제를 신고할 수 있습니다.',
        details:
          '해당 문제의 ‘문제 신고’를 열어 6개 사유 중 하나를 선택하고 설명을 입력합니다. 설명은 필수이며 최대 2,000자입니다. 이 안내 페이지에서는 신고를 접수하지 않습니다.',
        response:
          '신고는 운영자가 순서대로 확인해 문제를 고치는 데 씁니다. 처리 기한은 따로 정해 두지 않으며, 신고마다 개별 답변을 보내지는 않습니다.'
      },
      contact: {
        title: '문의',
        summary:
          '계정, 개인정보, 저작권에 관한 문의는 이메일로 받습니다: {{contactEmail}}',
        details:
          '문의할 때 비밀번호나 다른 사람의 개인정보를 보내지 마세요. 본인 확인을 위해 로그인에 쓰는 Google 이메일 주소로 보내 주세요.',
        contactUnset: '문의 이메일은 정식 공개 때 안내합니다.'
      }
    }
  },
  home: {
    today: {
      guestGreeting:
        '로그인 없이 하루 {{total}}번, {{count}}문제씩 풀 수 있어요',
      dueLabel: '복습할 문제도 {{count}}개 남아 있어요',
      prompt:
        '오늘은 {{level}} {{subject}} {{formattedCount}}문제 풀어 볼까요?',
      promptLimit:
        '내일 또 {{level}} {{subject}} {{formattedCount}}문제 풀어요',
      pickLevel: '급수 바꾸기',
      pickSubject: '과목 바꾸기',
      dueAction: '복습',
      guestLeftShort: '{{remaining}}번 남음',
      startGuest: '시작하기',
      startMember: '시작하기',
      resumeLabel: '풀던 {{level}} {{subject}}, {{summary}}',
      guestBenefit: '로그인하면 푼 기록이 남아요',
      weekLabel: '최근 7일 동안 {{level}} {{formattedCount}}문제를 풀었어요',
      dailyLabel: '오늘의 한 문제',
      dailyMeta: '{{level}} · {{subject}}',
      dailyOptionsLabel: '보기',
      dailyCorrect: '맞았어요',
      dailyIncorrect: '아쉬워요. 정답은 {{label}}번이에요',
      dailyYourAnswer: '내 답',
      dailyAnswer: '정답',
      dailyExplanation: '해설',
      dailyLoading: '오늘의 문제를 불러오는 중이에요',
      dailyError: '오늘의 문제를 불러오지 못했어요.',
      dailyRetry: '다시 불러오기'
    },
    approved: {
      vocabulary: '문자·어휘',
      title: '오늘도 일본어 한 세트',
      description: '급수와 과목만 고르면 바로 시작해요.',
      loading: '불러오는 중…'
    },
    quickDrill: {
      start: '{{level}} {{subject}} {{formattedCount}}문제 시작'
    },
    subjects: {
      vocabulary: {
        label: '문자·어휘',
        description: '한자 읽기·표기·뜻'
      },
      grammar: {
        label: '문법',
        description: '조사·활용·문장 만들기'
      },
      reading: {
        label: '독해',
        description: '글·안내문 읽고 답하기'
      }
    }
  },
  auth: {
    guestGate: {
      wrongNote: '틀린 문제가 여기에 모여요',
      wrongNoteBody:
        '로그인하고 풀면 틀린 문제가 저절로 모여요. 풀기는 로그인 없이도 돼요.',
      bookmarks: '다시 보고 싶은 문제를 담아 둘 수 있어요',
      bookmarksBody:
        '로그인하면 문제를 풀 때 책갈피에 담을 수 있어요. 풀기는 로그인 없이도 돼요.',
      dashboard: '푼 기록이 여기에 남아요',
      dashboardBody:
        '로그인하면 과목별 정답률과 목표 급수를 볼 수 있어요. 풀기는 로그인 없이도 돼요.',
      login: '로그인',
      toStudy: '그냥 풀러 가기'
    },
    guestToast: {
      login: '로그인',
      bookmark: '책갈피는 로그인하면 쓸 수 있어요.'
    },
    guestCarry: {
      done: '방금 푼 틀린 문제 {{formattedCount}}개를 오답노트에 모았어요.',
      failed:
        '방금 푼 문제를 오답노트로 옮기지 못했어요. 다음에 틀린 문제부터 모여요.'
    },
    recover: {
      title: '탈퇴 신청한 계정이에요',
      description:
        '<date>{{date}}</date>에 삭제될 예정이에요. 계정을 되살리면 학습 기록도 그대로 돌아와요.',
      restore: '계정 되살리기',
      keep: '그대로 탈퇴하기',
      restored: '계정을 되살렸어요. 학습 기록도 그대로예요.',
      kept: '{{date}}에 예정대로 삭제돼요.',
      tooLate: '이미 삭제가 시작되어 되살릴 수 없어요. 새로 가입해 주세요.',
      failed: '계정을 되살리지 못했어요. 잠시 뒤 다시 로그인해 주세요.'
    },
    reauth: {
      name: '본인 확인',
      description: '보안을 위해 Google로 한 번 더 로그인해 주세요.',
      go: 'Google로 확인하기',
      redirecting: 'Google로 이동하는 중…',
      returnNote: '확인이 끝나면 이 화면으로 돌아와요.',
      scopeAccount: '회원 탈퇴 전에는 꼭 본인 확인을 해요.',
      stepDone: '완료',
      account: {
        returned: '본인 확인을 마쳤어요. 마지막으로 한 번 더 확인해 주세요.',
        failed: '본인 확인을 마치지 못했어요. 다시 시도해 주세요.',
        cancelled: '본인 확인을 취소했어요.',
        wrongAccount: '가입할 때 쓴 Google 계정으로 다시 시도해 주세요.',
        invalid: '시간이 지나 확인이 끝났어요. 다시 시도해 주세요.'
      }
    },
    sso: {
      checkingAccount: '계정을 확인하는 중…',
      openAdminWork: '관리 작업이 남아 있어서 지금은 탈퇴할 수 없어요.',
      lastAdminDeletionBlocked:
        '관리자가 한 명뿐이라 지금은 탈퇴할 수 없어요. 다른 회원을 관리자로 먼저 지정한 뒤 다시 시도해 주세요.',
      title: '로그인',
      description: 'Google 계정으로 로그인하면 푼 기록이 계속 남아요.',
      guestHint:
        '로그인 없이도 하루 {{total}}번, 한 번에 {{count}}문제씩 풀 수 있어요. 기록은 남지 않아요.',
      guestLink: '로그인 없이 풀어 보기',
      checkingSession: '로그인 확인 중…',
      redirecting: '{{provider}}로 이동하는 중…',
      expired: '시간이 지나 로그인이 취소됐어요. 처음부터 다시 해 주세요.',
      unavailable: '지금은 로그인할 수 없어요. 잠시 뒤에 다시 시도해 주세요.',
      sessionExpired: '로그인이 끝났어요. 다시 로그인해 주세요.',
      migrationIncomplete:
        '로그인 방법을 불러오지 못했어요. 학습 기록은 그대로 있어요.',
      cancel: '취소',
      recheck: '다시 확인',
      logoutTitle: '로그아웃할까요?',
      logoutDescription: '로그아웃해도 푼 기록은 그대로 남아요.',
      logoutAction: '로그아웃',
      loggingOut: '로그아웃하는 중…',
      logoutUnknown: '로그아웃됐는지 확인하지 못했어요. 새로고침해 주세요.',
      unlinkTitle: '{{provider}} 연결을 해제할까요?',
      unlinkDescription:
        '연결 해제 후에는 연결된 다른 로그인 방법으로 로그인해 주세요. 학습 기록은 그대로 남고, 회원 탈퇴는 따로 해야 해요.',
      unlinkAction: '연결 해제',
      lastMethodTitle: '마지막 로그인 방법은 해제할 수 없어요.',
      deleteTitle: '회원 탈퇴할까요?',
      processing: '처리하는 중…',
      actionFailed: '처리하지 못했어요. 다시 시도해 주세요.',
      deletionAccepted:
        '탈퇴 신청을 받았어요. {{date}}에 모두 삭제돼요. 그 전에 다시 로그인하면 되살릴 수 있어요.',
      deletionAcceptedNoDate:
        '탈퇴 신청을 받았어요. 7일 뒤 모두 삭제돼요. 그 전에 다시 로그인하면 되살릴 수 있어요.',
      unlinked: '연결을 해제했어요.',
      legacyMethod:
        '로그인 방법이 Google로 바뀌었어요. Google 계정으로 계속해 주세요.',
      continueGoogle: 'Google로 계속하기',
      cancelledProvider:
        '{{provider}} 로그인을 취소했어요. 다시 시도하거나 로그인 없이 풀어 볼 수 있어요.',
      failedProvider: '{{provider}} 로그인에 실패했어요. 다시 시도해 주세요.',
      unavailableProvider:
        '지금은 {{provider}}로 로그인할 수 없어요. 잠시 뒤에 다시 시도해 주세요.',
      consentNotice:
        '계속하면 <terms>이용약관</terms>과 <privacy>개인정보 처리방침</privacy>을 확인한 것으로 봅니다. 만\u00a014세 미만은 가입할 수 없습니다.'
    }
  },
  practice: {
    name: '문제 풀기',
    setup: {
      formTitle: '무엇을 풀까요?',
      newTitle: '새로 풀기',
      modeSummary: '출제 방식',
      title: '무엇을 풀까요?',
      description: '준비된 문제가 고른 수보다 적으면 있는 만큼만 나와요.',
      resume: {
        title: '풀던 문제 이어서',
        description: '저장된 답은 24시간 동안 남아 있어요.',
        refreshing: '새로고침 중…',
        loading: '풀던 문제를 찾는 중…',
        offline: '인터넷 연결이 끊겼어요. 연결되면 다시 불러올게요.',
        cachedOffline:
          '인터넷 연결이 끊겨서 마지막으로 불러온 목록을 보여 드려요. 연결될 때까지 버리기와 쪽 넘기기는 할 수 없어요.',
        stale: '목록을 새로 불러오지 못했어요. 마지막으로 불러온 목록이에요.',
        error: '풀던 문제 목록을 불러오지 못했어요.',
        summary: '{{formattedCount}}문제 중 {{formattedOrdinal}}번까지',
        lastSaved: '{{date}}에 저장',
        notSaved: '아직 푼 문제 없음',
        legacyUnavailable:
          '이 학습은 더 이어 풀 수 없어요. 새로 시작해 주세요.',
        action: '이어 풀기',
        cancel: '버리기'
      },
      steps: {
        level: '급수',
        subject: '과목',
        mode: '출제 방식',
        count: '문제 수'
      },
      questionCount: '{{formattedCount}}문제',
      modes: {
        RANDOM: {
          label: '랜덤',
          description: '고른 급수와 과목에서 아무 문제나 나와요.'
        },
        WRONG_NOTE: {
          label: '틀린 문제',
          description: '복습할 문제에서 나와요.'
        },
        WEAKNESS: {
          label: '약한 문제',
          description: '요즘 자주 틀리는 문제가 먼저 나와요.'
        },
        BOOKMARK: {
          label: '책갈피',
          description: '책갈피에 담은 문제만 나와요.'
        },
        DAILY_REVIEW: {
          label: '복습할 문제 풀기',
          description: '복습할 문제를 오래전에 틀린 것부터 10문제 내요.',
          empty: '복습할 문제가 없어요. 다른 방식으로 풀어 보세요.'
        }
      },
      dailyLimit: {
        title: '오늘 {{total}}번을 다 풀었어요',
        description: '로그인하면 계속 풀고, 틀린 문제도 모아 둘 수 있어요.',
        login: 'Google로 로그인',
        reset: '내일 0시에 다시 {{total}}번'
      },
      sessionCap: {
        hourTitle: '잠깐 쉬었다 풀어요',
        hourBody:
          '한 시간에 풀 수 있는 새 세트를 다 풀었어요. {{time}}부터 다시 풀 수 있어요. 오답 노트 복습은 지금도 할 수 있어요.',
        dayTitle: '오늘은 여기까지 풀었어요',
        dayBody:
          '오늘 풀 수 있는 새 세트를 다 풀었어요. 내일 또 풀어요. 오답 노트 복습은 지금도 할 수 있어요.'
      },
      urlLocked: '문제 수와 출제 방식은 로그인하면 고를 수 있어요.',
      availableCountNote: '문제가 모자라면 있는 만큼만 나와요.',
      noEligibleTitle:
        "지금 조건으로는 '{{mode}}'에서 풀 수 있는 문제가 없어요.",
      noEligibleDescription:
        '급수·과목·출제 방식을 바꾸거나 랜덤으로 풀어 보세요.',
      selectRandom: '랜덤으로 바꾸기',
      createError:
        '학습을 시작하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
      cancelDialog: {
        title: '풀던 문제를 버릴까요?',
        description: '저장한 답이 지워지고 다시 이어 풀 수 없어요.',
        keep: '그대로 두기',
        confirm: '버리기',
        error: '버리지 못했어요. 다시 시도해 주세요.'
      }
    },
    session: {
      loading: {
        questions: '문제를 준비하고 있어요…',
        guestOwnership: '문제를 준비하는 중…',
        resultRedirect: '결과로 이동하는 중…',
        draft: '저장한 답을 불러오는 중…'
      },
      recovery: {
        title: '채점 결과를 확인하고 있어요',
        pendingDescription:
          '제출한 답이 채점됐는지 확인하는 중이라 지금은 답을 바꾸거나 나갈 수 없어요. 인터넷이 연결되면 바로 확인할게요.',
        failedDescription:
          '제출한 답이 채점됐는지 확인하지 못했어요. 인터넷 연결을 확인하고 [다시 확인]을 눌러 주세요. 답은 그대로 남아 있어요.',
        retry: '다시 확인',
        checkingStatus: '확인하는 중이에요. 잠시 이 화면에서 기다려 주세요.',
        connectedStatus: '인터넷에 연결됐어요. [다시 확인]을 눌러 주세요.'
      },
      errors: {
        sessionLoadTitle: '문제를 불러오지 못했어요',
        sessionLoadDescription: '주소가 맞는지 확인하거나 새로 시작해 주세요.',
        offlineSessionDescription:
          '인터넷 연결이 끊겼어요. 연결되면 다시 불러올게요.',
        cachedOfflineDescription:
          '인터넷 연결이 끊겼어요. 지금 화면은 그대로 두지만, 연결될 때까지 답을 바꾸거나 제출할 수 없어요.',
        staleSessionDescription:
          '최신 상태를 불러오지 못했어요. 푼 답은 그대로 있지만, 다시 확인하기 전까지 답을 바꾸거나 제출할 수 없어요.',
        retrySession: '다시 불러오기',
        draftLoadTitle: '저장한 답을 불러오지 못했어요',
        draftLoadDescription:
          '이어 풀려면 저장한 답을 먼저 불러와야 해요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
        emptyTitle: '풀 수 있는 문제가 없어요',
        emptyDescription: '급수, 과목, 출제 방식을 바꿔 보세요.'
      },
      terminal: {
        notFoundTitle: '이 학습을 찾을 수 없어요',
        notFoundDescription:
          '이미 끝났거나 열 수 없는 학습이에요. 새로 시작해 주세요.',
        retiredTitle: '이 학습은 끝났어요',
        retiredDescription: '이어서 풀 수 없어요. 새로 시작해 주세요.',
        expiredTitle: '24시간이 지나 끝난 학습이에요',
        cancelledTitle: '버린 학습이에요',
        description: '이 학습에는 더 답할 수 없어요. 새로 시작해 주세요.',
        openSetup: '새로 시작하기'
      },
      exitGuest: {
        title: '그만 풀까요?',
        description: '나가면 지금 푼 답은 저장되지 않아요.',
        keep: '계속 풀기',
        leave: '나가기'
      },
      header: {
        backToSetup: '학습 화면으로',
        backToExplanation: '해설로 돌아가기',

        progressSummary: '{{current}}/{{total}}번 · {{answered}}문제 답함'
      },
      draft: {
        retryShort: '다시 시도',
        inline: {
          reconciled: '다른 곳에서 푼 답을 불러왔어요. 답을 확인해 주세요.',
          saved: '자동 저장됨',
          saving: '저장하는 중…',
          error: '저장하지 못했어요',
          dirty: '저장 대기 중',
          offline: '연결 끊김 · 이 기기에만 저장 중'
        },
        status: {
          reconciled: '다른 곳에서 푼 답을 불러왔어요. 답을 확인해 주세요.',
          remoteDeferred:
            '다른 창에서도 이 문제를 풀고 있어요. 어느 답이 최신인지 확인하는 중이에요.',
          conflictPending: '최신 답을 확인하는 중이에요.',
          dirty: '바꾼 답을 이 창에 잠시 보관했어요.',
          saving: '저장하는 중…',
          savedAt: '{{time}}에 저장했어요.',
          saved: '저장했어요.',
          offline:
            '인터넷 연결이 끊겼어요. 답은 이 기기에 보관했다가 연결되면 저장할게요.',
          conflict: '최신 답을 확인하는 중이에요.',
          error:
            '저장하지 못했어요. 고른 답은 그대로 있어요. 다시 시도해 주세요.',
          synced: '모두 저장됐어요.'
        },
        conflictCheckPending:
          '최신 답을 확인하는 동안 잠시 저장과 제출을 멈출게요.',
        retry: '다시 저장',
        notices: {
          saveBeforeLeaveFailed: '답을 저장하지 못해서 나가지 않았어요.',
          conflictRefreshComplete:
            '최신 답을 불러왔어요. 확인하고 다시 제출해 주세요.',
          sessionRefreshFailed: '최신 상태를 불러오지 못했어요.',
          submissionPreparationFailed:
            '답을 저장하지 못해서 제출하지 않았어요.',
          retrySaveFailed:
            '다시 저장하지 못했어요. 인터넷 연결을 확인해 주세요.'
        }
      },
      supply: {
        canonicalPartial:
          '{{requested}}문제를 골랐지만 지금 풀 수 있는 문제가 {{actual}}문제라 {{actual}}문제만 나왔어요.'
      },
      progressLabel: '{{percent}}% 답함',
      question: {
        passageBackToTop: '지문 다시 보기',
        passageLabel: '지문',
        numberLabel: '{{ordinal}}번 문제.',
        answerLegend: '보기'
      },
      bookmark: {
        addLabel: '{{ordinal}}번 문제를 책갈피에 담기',
        removeLabel: '{{ordinal}}번 문제를 책갈피에서 빼기',
        legacyReadOnly: '이 학습에서는 책갈피를 바꿀 수 없어요.',
        removed: '책갈피에서 뺐어요.',
        removeRollback: '책갈피에서 빼지 못했어요. 다시 시도해 주세요.',
        saved: '책갈피에 담았어요.',
        saveRollback: '책갈피에 담지 못했어요. 다시 시도해 주세요.',
        offlineQueued: '인터넷 연결이 끊겼어요. 연결되면 책갈피에 반영할게요.',
        statusLoadOffline:
          '인터넷 연결이 끊겨 책갈피를 확인할 수 없어요. 연결되면 다시 확인할게요.',
        statusLoadFailed: '책갈피를 확인하지 못했어요.',
        retryStatus: '다시 확인'
      },
      navigation: {
        previous: '이전',
        next: '다음',
        submit: '제출하기',
        jumpLabel: '문제 번호',
        jumpQuestionAnswered: '{{ordinal}}번, 답함',
        jumpQuestionUnanswered: '{{ordinal}}번, 아직 안 풂'
      },
      submit: {
        title: '제출할까요?',
        frozenDescription:
          '아까 보낸 답 그대로 다시 제출해요. 결과가 나올 때까지 답을 바꿀 수 없어요.',
        unansweredDescription:
          '아직 안 푼 문제가 {{unanswered}}개 있어요. 안 푼 문제는 틀린 것으로 채점돼요.',
        completeDescription:
          '모든 문제를 풀었어요. 제출하면 답을 바꿀 수 없어요.',
        continue: '계속 풀기',
        confirm: '제출하고 결과 보기',
        frozenFailure:
          '결과를 받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요. 답은 그대로 있어요.',
        requestFailure: '제출하지 못했어요. 잠시 뒤에 다시 시도해 주세요.',
        connectivity: {
          offline: '인터넷 연결이 끊겼어요. 연결되면 다시 제출해 주세요.',
          restored: '인터넷에 다시 연결됐어요. 지금 다시 제출할 수 있어요.'
        }
      },
      conflict: {
        title: '다른 기기에서 푼 답과 달라요',
        description:
          '{{conflicts}}문제의 답이 서로 달라요. 어느 쪽 답을 남길지 골라 주세요.',
        useServer: '저장된 답 쓰기',
        keepLocal: '이 화면의 답 쓰기',
        detail:
          "'저장된 답 쓰기'를 고르면 이 화면에서 바꾼 답은 사라져요. '이 화면의 답 쓰기'를 고르면 이 화면의 답으로 저장해요."
      }
    }
  },
  result: {
    retired: {
      title: '이 결과는 더 볼 수 없어요',
      description: '새로 풀어 보세요.'
    },
    navigation: {
      label: '문제 번호',
      question: '{{formattedOrdinal}}번',
      emptyTitle: '볼 문제가 없어요',
      emptyDescription: '학습 화면에서 새 문제를 풀어 보세요.'
    },
    name: '결과',
    summary: {
      score: '{{total}}문제 중 {{correct}}개 맞음',
      meta: '정답률 {{accuracy}} · {{duration}}'
    },
    grading: {
      checking: '채점하고 있어요',
      done: '채점 결과',
      skipHint: '누르면 바로 볼 수 있어요',
      showResult: '결과 보기'
    },
    nextActions: {
      title: '다음에 할 일'
    },
    outcomesNote: '안 푼 문제도 틀린 것으로 채점돼요.',
    loading: '채점 결과를 불러오는 중…',
    error: {
      title: '결과를 불러오지 못했어요',
      description: '인터넷 연결을 확인하고 다시 시도해 주세요.',
      offlineTitle: '인터넷 연결이 끊겼어요',
      offlineDescription: '연결되면 결과를 다시 불러올게요.',
      cachedOffline:
        '인터넷 연결이 끊겨 마지막으로 불러온 결과를 보여 드려요. 연결될 때까지 다시 풀기는 할 수 없어요.',
      staleDescription:
        '최신 결과를 불러오지 못해 마지막으로 불러온 결과를 보여 드려요. 다시 불러오기 전까지 다시 풀기는 할 수 없어요.'
    },
    notFound: {
      title: '결과를 찾을 수 없어요',
      description: '아직 제출하지 않았거나 기간이 지난 학습이에요.',
      retrySourceDescription: '다시 풀 원래 결과를 찾을 수 없어요.'
    },
    newPractice: '새 문제 풀기',
    metrics: {
      durationValue: '{{minutes}}분 {{seconds}}초'
    },
    status: {
      guest: '틀린 {{formattedCount}}문제, 오답노트에 모아 둘까요?',
      guestAllCorrect: '로그인하면 다음부터 틀린 문제가 오답노트에 모여요.',
      savedWrongCount: '틀린 {{formattedCount}}문제를 오답노트에 담았어요.'
    },
    actions: {
      retryIncorrect: '틀린 문제만 다시 풀기',
      nextSet: '다음 {{formattedCount}}문제',
      nextSetStarting: '새 문제를 준비하는 중…',
      backToWrongNotes: '오답노트로',
      backToBookmarks: '책갈피로'
    },
    retry: {
      checking: '확인하는 중…',
      waitingConnection: '연결을 기다리는 중…',
      creating: '준비하는 중…',
      noEligibleTitle: '지금 다시 풀 수 있는 틀린 문제가 없어요',
      noEligibleDescription: '틀린 문제가 지금은 풀 수 없는 상태예요.',
      unsupported:
        '이 결과에서는 틀린 문제만 다시 풀 수 없어요. 새 문제를 풀어 보세요.',
      offline: '인터넷 연결이 끊겼어요. 연결되면 바로 이어서 준비할게요.',
      errorTitle: '다시 풀기를 시작하지 못했어요.',
      errorDescription: '인터넷 연결을 확인하고 같은 버튼을 다시 눌러 주세요.',
      priorEnded:
        '전에 시작한 다시 풀기는 끝났어요. 다시 누르면 새로 시작해요.',
      sourceRefreshing: '결과를 다시 확인하는 중이에요.'
    },
    items: {
      title: '문제별 결과',
      correct: '맞음',
      incorrect: '틀림',
      ordinal: '{{formattedOrdinal}}번',
      selectedAnswer: '내 답',
      unanswered: '안 풂',
      correctAnswer: '정답',
      correctAnswerUnavailable: '정답을 불러오지 못했어요',
      explanation: '해설'
    },
    bookmark: {
      offline: '인터넷 연결이 끊겼어요. 연결되면 책갈피에 반영할게요.',
      loadOffline:
        '인터넷 연결이 끊겨 책갈피를 확인할 수 없어요. 연결되면 다시 확인할게요.',
      loadError: '책갈피를 확인하지 못했어요.',
      retry: '다시 확인',
      add: '책갈피',
      addLabel: '{{formattedOrdinal}}번 문제를 책갈피에 담기',
      remove: '책갈피 빼기',
      removeLabel: '{{formattedOrdinal}}번 문제를 책갈피에서 빼기',
      unavailable: '이 결과에서는 책갈피를 바꿀 수 없어요.',
      removed: '책갈피에서 뺐어요.',
      removeFailed: '책갈피에서 빼지 못했어요. 다시 시도해 주세요.',
      saved: '책갈피에 담았어요.',
      saveFailed: '책갈피에 담지 못했어요. 다시 시도해 주세요.'
    },
    blocker: {
      title: '틀린 문제를 다시 풀 준비를 하고 있어요',
      description:
        '준비되면 바로 문제 화면으로 넘어가요. 잠시만 기다려 주세요.',
      stay: '기다리기'
    }
  },
  wrongNote: {
    title: '오답노트',
    rule: "틀린 문제는 여기 모여요. 다시 풀어서 맞히면 '복습한 문제'로 옮겨요.",
    levelLabel: '급수',
    levelAll: '전체',
    start: '복습 시작',
    startEmpty: '복습할 문제가 없어요. 목록을 새로 불러왔어요.',
    startError: '복습을 시작하지 못했어요. 다시 눌러 주세요.',
    loadError: '오답노트를 불러오지 못했어요.',
    retry: '다시 불러오기',
    tabs: {
      toReview: '복습할 문제 {{formattedCount}}',
      reviewed: '복습한 문제 {{formattedCount}}'
    },
    card: {
      wrongCount: '{{count}}번 틀림',
      reviewedMeta: '{{date}}에 맞힘'
    },
    empty: {
      levelNone: '{{level}} 문제는 없어요.',
      startNew: '새 문제 풀기',
      showAll: '전체 보기',
      never: {
        title: '아직 틀린 문제가 없어요. 풀다 틀리면 여기 모여요.'
      },
      allDone: {
        title: '복습할 문제를 다 풀었어요',
        body: '다른 문제를 풀다 또 틀리면 다시 여기 모여요.'
      },
      noReviewed: {
        title: '아직 복습한 문제가 없어요',
        body: '복습할 문제를 다시 풀어서 맞히면 여기로 옮겨요.'
      }
    },
    integration: {
      title: '복습',
      status: {
        TO_REVIEW: '복습할 문제',
        REVIEWED: '복습한 문제'
      },
      count: '{{formattedCount}}문제',
      back: '복습 목록으로',
      guest: {
        result: '방금 푼 결과'
      },
      empty: {
        title: '아직 복습할 문제가 없어요.',
        description: '학습 중 틀린 문제가 생기면 여기에서 다시 볼 수 있어요.'
      },
      filtered: {
        title: '이 조건에 맞는 문제가 없어요.',
        description: '급수나 과목을 바꾸어 보세요.'
      },
      complete: {
        title: '복습 결과',
        correct: '맞혔어요!',
        wrong: '아쉽게 틀렸어요.',
        states: {
          REVIEWED: "맞혀서 '복습한 문제'로 옮겼어요.",
          TO_REVIEW: "아직 '복습할 문제'에 있어요. 해설을 읽고 다시 풀어 봐요."
        },
        checking: '채점했어요. 오답노트에 반영하는 중이에요.',
        unknown:
          '채점은 됐지만 오답노트에 반영됐는지 확인하지 못했어요. 다시 제출할 필요는 없어요.',
        retryStatus: '다시 확인',
        current: '오답노트',
        selected: '내 답',
        unanswered: '답을 고르지 않았어요.',
        unconfirmed: '확인 못 함'
      }
    },
    name: '오답노트',
    center: {
      title: '오답 복습',
      description: '틀린 문제를 다시 풀고, 익숙해진 문제는 해결로 옮겨 보세요.',
      states: {
        offline: '인터넷 연결이 끊겼어요. 연결되면 다시 불러올게요.',
        loading: '불러오는 중…',
        errorDescription: '인터넷 연결을 확인하고 다시 시도해 주세요.'
      },
      results: {
        pagination: '오답노트 쪽'
      }
    },
    list: {
      head: {
        levelSubject: '급수·과목',
        question: '문제',
        wrongCount: '틀린 횟수',
        wrongDate: '틀린 날',
        reviewedDate: '맞힌 날'
      }
    },
    detail: {
      report: '문제가 이상해요',
      versionChanged: '문제가 고쳐졌어요. 다시 풀면 고친 문제가 나와요.',
      correctAnswer: '정답',
      noAnswer: '안 고름',
      myAnswer: '내 답',
      back: '오답노트로',
      title: '마지막 오답 문제 상세',
      snapshotNotice:
        '아래 문제·보기·해설은 마지막으로 틀렸을 때 고정된 문제 버전이에요.',
      previousAnswer: {
        selected: '내가 고른 답',
        unanswered: '내가 고른 답: 없음(안 풂)',
        unavailable: '내가 고른 답을 불러올 수 없어요',
        loading: '내가 고른 답을 불러오는 중…',
        error: '내가 고른 답을 불러오지 못했어요.',
        paused: '인터넷이 연결되면 내가 고른 답을 불러올게요.'
      },
      correct: '정답',
      explanation: '해설',
      review: {
        title: '복습 기록',
        wrongCount: '틀린 횟수',
        streak: '연속 정답',
        count: '{{formattedCount}}회',
        lastWrong: '최근 오답',
        nextReview: '다음 복습',
        lastReview: '최근 복습',
        noRecord: '기록 없음',
        archived: '이 문제는 지금 풀 수 없어요.',
        available:
          '현재 출제 가능한 문제 버전으로 단일 복습을 시작할 수 있어요.'
      },
      states: {
        coldOfflineTitle: '인터넷 연결이 끊겨 불러올 수 없어요',
        coldOfflineDescription: '연결되면 다시 불러올게요.',
        loading: '불러오는 중…',
        notFoundTitle: '이 문제를 찾을 수 없어요',
        notFoundDescription: '지워졌거나 내 오답노트에 없는 문제예요.',
        loadErrorTitle: '불러오지 못했어요',
        loadErrorDescription: '인터넷 연결을 확인하고 다시 시도해 주세요.',
        backHistory: '전체 오답 기록으로 돌아가기',
        backDashboard: '학습 대시보드로 돌아가기',
        backCenter: '오답노트로',
        cachedOffline:
          '인터넷 연결이 끊겼어요. 저장된 내용을 보여 드리고, 연결되면 다시 확인할게요.',
        stale: '최신 내용을 불러오지 못했어요. 보이는 내용은 그대로 있어요.',
        retry: '다시 불러오기'
      },
      targeted: {
        waitingConnection: '연결을 기다리는 중…',
        loading: '준비하는 중…',
        recover: '풀던 것 이어 풀기',
        start: '이 문제 다시 풀기',
        archivedRecovery:
          '이 문제는 지금 풀 수 없지만, 전에 시작한 것은 이어 풀 수 있어요.',
        offline: '인터넷 연결이 끊겼어요. 연결되면 바로 이어서 준비할게요.',
        unavailable: '이 문제는 지금 풀 수 없어요.',
        error: '다시 풀기를 시작하지 못했어요. 다시 눌러 주세요.',
        archivedOnly: '지금은 풀 수 없는 문제라 기록만 볼 수 있어요.',
        endedArchived:
          '전에 시작한 다시 풀기가 끝났어요. 이 문제는 지금 풀 수 없어요.',
        endedAvailable:
          '전에 시작한 다시 풀기가 끝났어요. 다시 누르면 새로 시작해요.'
      }
    }
  },
  bookmark: {
    name: '책갈피',
    loading: '불러오는 중…',
    error: {
      title: '책갈피를 불러오지 못했어요',
      description: '잠시 뒤에 다시 시도해 주세요.',
      offlineTitle: '인터넷 연결이 끊겼어요',
      offlineDescription: '연결되면 책갈피를 다시 불러올게요.',
      cachedOffline:
        '인터넷 연결이 끊겼어요. 지금 목록은 그대로 두고, 연결되면 이어서 불러올게요.',
      staleDescription:
        '최신 목록을 불러오지 못했어요. 지금 보이는 목록은 그대로 둘게요.'
    },
    status: {
      removing: '빼는 중…',
      removed: '책갈피에서 뺐어요.',
      restoreFailed: '책갈피에서 빼지 못했어요. 다시 시도해 주세요.',
      offline: '인터넷 연결이 끊겼어요. 연결되면 책갈피에 반영할게요.'
    },
    title: '책갈피',
    listCount: '{{formattedCount}}문제',
    sortSaved: '담은 순',
    savedOn: '{{date}}에 담음',
    description: '다시 보고 싶은 문제를 모아 두는 곳이에요.',
    empty: {
      firstTitle: '책갈피에 담은 문제가 없어요',
      pageTitle: '이 쪽에는 문제가 없어요',
      firstDescription: '문제를 풀 때 책갈피를 누르면 여기에 모여요.',
      pageDescription: '앞쪽으로 가 보세요.',
      start: '문제 풀러 가기',
      previousPage: '앞쪽'
    },
    practice: {
      title: '책갈피 문제 풀기',
      description: '급수·과목별로 담은 순서대로 나와요.',
      groupAction: '{{level}} {{subject}} 풀기 (최대 {{formattedCount}}문제)',
      allArchived: '이 쪽의 문제는 모두 지금 풀 수 없어요.',
      noneAvailable: '지금 풀 수 있는 책갈피 문제가 없어요.',
      refresh: '새로고침',
      offline: '인터넷 연결이 끊겼어요. 연결되면 다시 눌러 주세요.',
      startError: '시작하지 못했어요. 잠시 뒤에 다시 시도해 주세요.'
    },
    remove: '책갈피 빼기',
    removeDialog: {
      title: '책갈피에서 뺄까요?',
      description: '문제를 풀 때 다시 담을 수 있어요.',
      cancel: '그대로 두기',
      confirm: '빼기'
    },
    pagination: {
      label: '책갈피 쪽',
      refreshing: '불러오는 중…',
      status: '{{page}} / {{pageCount}}쪽'
    }
  },
  account: {
    targetLevel: {
      label: '목표 급수',
      hint: "홈의 '오늘의 한 문제'와 연습을 이 급수로 시작해요.",
      unset: '정하지 않음',
      saveAction: '저장',
      saved: '목표 급수를 바꿨어요. 이제 {{level}} 문제로 시작해요.',
      error: '저장하지 못했어요. 잠시 뒤 다시 저장해 주세요.'
    },
    title: '마이페이지',
    study: {
      title: '{{level}} 학습',
      recentRowResult: '{{total}}문제 중 {{correct}}개 맞음',
      totalUnit: '문제',
      rate: '정답률',
      noRecord: '기록 없음',
      recent: '최근 학습',
      emptyTitle: '아직 {{level}} 문제를 풀지 않았어요',
      emptyDescription: '{{level}} 문제를 풀면 과목별 정답률이 여기 나와요.',
      emptyAction: '{{level}} 문제 풀기',
      error: '학습 기록을 불러오지 못했어요.',
      retry: '다시 시도',
      loading: '불러오는 중…',
      tier: {
        high: '높음',
        mid: '보통',
        low: '낮음'
      },
      recentMore:
        '최근 5번까지 보여요. 틀린 문제는 <notes>오답노트</notes>에 모여 있어요.'
    },
    settings: {
      title: '계정',
      signInMethod: '로그인 방법',
      logoutDescription: '이 기기에서 로그아웃해요. 학습 기록은 그대로 남아요.'
    },
    danger: {
      title: '회원 탈퇴',
      description:
        '탈퇴하면 바로 로그아웃되고, 7일 뒤 학습 기록·오답노트·메모·책갈피·복습 일정과 계정 정보가 삭제돼요. 7일 안에 다시 로그인하면 되살릴 수 있어요.\nGoogle 계정은 삭제되지 않아요.',
      action: '회원 탈퇴'
    },
    confirm: {
      stepDelete: '마지막 확인',
      stepUnlink: '연결 해제 최종 확인',
      deleteDescription: {
        scope:
          '탈퇴하면 바로 로그아웃되고, 7일 뒤 학습 기록·오답노트·메모·책갈피·복습 일정과 계정 정보(이름·이메일)가 삭제돼요. 그 전에 다시 로그인하면 되살릴 수 있고, 7일이 지나면 되돌릴 수 없어요.',
        reports:
          '보내 주신 문제 신고는 설명을 지우고 계정과 연결을 끊은 채 남아요.',
        google:
          "Google 계정은 삭제되지 않아요. Google 계정 설정의 '타사 앱 연결'에서 하루마루 연결을 직접 해제할 수 있어요."
      }
    },
    dataGuide: '내 데이터는 어떻게 처리되나요?',
    data: {
      description:
        '로그아웃하면 이 기기에서만 나가요. 회원 탈퇴를 하면 계정과 학습 기록이 지워져요.',
      privacyLink: '개인정보 처리방침 보기'
    }
  },
  errors: {
    forbidden: {
      memberDescription: '이 계정으로는 볼 수 없는 화면이에요.',
      guestDescription: '로그인하면 볼 수 있어요.',
      accountAction: '로그인하기',
      title: '볼 수 없는 화면이에요',
      description: '운영자만 볼 수 있는 화면이에요.',
      action: '처음으로'
    },
    notFound: {
      title: '없는 페이지예요',
      description: '주소를 확인하거나 처음 화면에서 다시 시작해 주세요.'
    },
    route: {
      title: '화면을 불러오지 못했어요',
      fallback: '알 수 없는 문제가 생겼어요. 새로고침해 주세요.'
    },
    authStatus: {
      title: '로그인을 확인하지 못했어요',
      description: '잠시 뒤에 다시 시도해 주세요.',
      offlineTitle: '인터넷 연결이 끊겼어요',
      offlineDescription: '연결되면 로그인을 다시 확인할게요.'
    },
    banner: {
      generic: '처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.',
      network: '인터넷 연결이 불안정해요. 다시 시도해 주세요.',
      response: '문제가 생겼어요. 다시 시도해 주세요.',
      validation: '입력한 내용을 확인해 주세요.',
      server: '문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.'
    }
  },
  a11y: {
    japaneseContent: '일본어 문장'
  }
} as const
