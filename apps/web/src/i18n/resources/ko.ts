export const koResources = {
  common: {
    appName: 'JLPT Drill Note',
    tagline: '풀고, 남기고, 다시',
    locale: {
      label: '언어',
      ko: '한국어',
      ja: '日本語'
    },
    loading: {
      content: '콘텐츠를 불러오는 중입니다…',
      page: '페이지를 불러오는 중입니다…',
      auth: '로그인 상태를 확인하고 있습니다…',
      mockNotice: 'Mock 계정 안내를 불러오고 있습니다…',
      processing: '처리 중…'
    },
    actions: {
      retry: '다시 시도',
      close: '닫기',
      closeDialog: '대화상자 닫기',
      closeNotification: '알림 닫기',
      goHome: '홈으로 이동',
      goLogin: '로그인으로 이동',
      goRandomPractice: 'RANDOM 학습으로 이동',
      login: '로그인'
    },
    state: {
      requestFailed: '요청을 완료하지 못했습니다'
    },
    required: '(필수)',
    pagination: {
      label: '페이지 이동',
      previous: '이전',
      previousLabel: '이전 페이지',
      next: '다음',
      nextLabel: '다음 페이지',
      pageLabel: '{{page}}페이지{{current}}',
      currentSuffix: ', 현재 페이지'
    },
    toast: {
      region: '알림',
      info: '안내',
      success: '성공',
      warning: '주의',
      danger: '오류'
    },
    footer: {
      originalContent: '자체 제작 문제만 사용하는 포트폴리오 프로젝트입니다.',
      scope: '청해·실제 JLPT 기출문제는 포함하지 않습니다.'
    }
  },
  navigation: {
    skipToContent: '본문으로 바로가기',
    menuOpen: '메뉴 열기',
    menuClose: '메뉴 닫기',
    primary: '주요 메뉴',
    practice: '문제풀이',
    wrongNotes: '오답노트',
    bookmarks: '즐겨찾기',
    dashboard: '대시보드',
    adminQuestions: '문제 관리',
    login: '로그인',
    routeChanged: '{{route}} 화면으로 이동했습니다.',
    documentTitle: '{{route}} | JLPT Drill Note',
    metaDescription:
      'JLPT N5부터 N1까지 문제를 풀고 오답을 반복 학습하는 JLPT Drill Note',
    routes: {
      home: '홈',
      login: '로그인',
      resetPassword: '비밀번호 재설정',
      verifyEmail: '이메일 인증',
      dashboard: '학습 대시보드',
      practiceSetup: '문제풀이 설정',
      practiceSession: '문제풀이',
      result: '학습 결과',
      wrongNoteCenter: '오답 복습 센터',
      wrongNoteHistory: '전체 오답 기록',
      wrongNoteDetail: '오답 상세',
      bookmarks: '즐겨찾기',
      adminQuestionNew: '문제 등록',
      adminQuestionImport: '문제 가져오기',
      adminQuestionDetail: '문제 상세',
      adminQuestions: '문제 관리',
      adminAudit: '관리자 감사 기록',
      adminReportDetail: '문제 신고 상세',
      adminReports: '문제 신고 큐',
      forbidden: '접근 권한 없음',
      page: '페이지'
    }
  },
  home: {
    eyebrow: 'JLPT N5–N1 · VOCABULARY / GRAMMAR / READING',
    hero: {
      titleLine1: '틀린 문제를',
      titleLine2: '끝까지 해결하는 학습',
      description:
        '급수와 과목을 고르고 바로 문제를 푸세요. 제출한 오답은 자동으로 정리되고, 두 번 연속 맞힐 때까지 복습 흐름이 이어집니다.',
      openSetup: '학습 설정 열기',
      accountLogin: '계정 로그인',
      myDashboard: '내 학습 대시보드'
    },
    quickDrill: {
      eyebrow: 'QUICK DRILL',
      title: '10문제 바로 풀기',
      defaultMode: '기본 RANDOM',
      levelLegend: 'JLPT 급수',
      subjectLegend: '학습 과목',
      start: '선택한 범위로 시작',
      error:
        '세션을 만들지 못했습니다. 네트워크 상태와 선택 조건을 확인한 뒤 다시 시도해 주세요.',
      countNote: '문제가 10개보다 적으면 준비된 문제 수만큼 출제합니다.'
    },
    subjects: {
      vocabulary: {
        label: '문자·어휘',
        description: '한자 읽기와 문맥 어휘'
      },
      grammar: {
        label: '문법',
        description: '형식 선택과 문장 구성'
      },
      reading: {
        label: '독해',
        description: '짧은 글부터 정보 검색까지'
      }
    },
    loop: {
      eyebrow: 'LEARNING LOOP',
      title: '문제를 푸는 순간부터 복습까지 연결됩니다',
      items: {
        wrongNote: {
          title: '자동 오답노트',
          description:
            '틀린 횟수와 복습 상태를 기록해 다시 볼 문제를 놓치지 않습니다.'
        },
        weakness: {
          title: '약점 분석',
          description:
            '과목별 정답률과 반복 오답을 기반으로 다음 학습 방향을 잡습니다.'
        },
        mastery: {
          title: '2회 연속 정답',
          description:
            '한 번의 우연이 아니라 두 번 연속 맞힐 때 해결한 문제로 전환합니다.'
        }
      }
    }
  },
  auth: {
    eyebrow: 'SECURE ACCESS',
    title: '학습 계정으로 시작하세요',
    description: {
      mock: '현재 로컬 Mock 인증 모드입니다. 아래 데모 계정 로그인만 제공하며 인증 상태는 로컬 데모 저장소에만 보관됩니다.',
      real: '이메일 인증을 마친 계정으로 로그인하면 오답노트와 학습 기록을 안전하게 이어갈 수 있습니다. 인증 정보는 브라우저 저장소가 아닌 보안 쿠키로 관리됩니다.'
    },
    currentAccount: '현재 계정',
    logout: '로그아웃',
    methodLabel: '인증 방식',
    signIn: '로그인',
    signUp: '회원가입',
    forgotPassword: '비밀번호를 잊으셨나요?',
    fields: {
      name: '이름',
      email: '이메일',
      password: '비밀번호',
      newPassword: '새 비밀번호',
      targetLevel: '목표 급수'
    },
    hints: {
      password: '12자 이상 입력해 주세요.',
      newPassword: '12자 이상 128자 이하로 입력해 주세요.'
    },
    notices: {
      registration:
        '가입 요청을 완료했습니다. 받은 편지함에서 이메일 인증을 마친 뒤 로그인해 주세요.',
      resetRequested:
        '가입 여부와 관계없이 요청을 접수했습니다. 계정이 존재하면 재설정 링크를 전송합니다.'
    },
    errors: {
      request:
        '인증 요청을 처리하지 못했습니다. 입력 정보와 네트워크 상태를 확인해 주세요.',
      resetRequest:
        '재설정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      temporary: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      resetUnsupported:
        'Mock 모드에서는 비밀번호 재설정을 지원하지 않습니다. real API 모드에서 다시 시도해 주세요.',
      resetExpired:
        '링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해 주세요.',
      verifyUnsupported:
        'Mock 모드에서는 이메일 인증을 지원하지 않습니다. real API 모드에서 다시 시도해 주세요.',
      verifyExpired:
        '링크가 만료되었거나 이미 사용되었습니다. 새 인증 메일을 요청해 주세요.'
    },
    signUpAction: '이메일 인증 요청',
    reset: {
      title: '비밀번호 재설정',
      description:
        '계정 이메일을 입력하면 1시간 동안 유효한 재설정 링크를 보냅니다.',
      requestAction: '재설정 링크 요청',
      backToLogin: '로그인으로 돌아가기',
      invalidTitle: '유효하지 않은 재설정 링크',
      missingToken:
        '재설정 토큰이 없습니다. 로그인 화면에서 새 링크를 요청해 주세요.',
      successTitle: '비밀번호를 변경했습니다',
      successDescription:
        '기존 로그인 세션은 모두 종료했습니다. 새 비밀번호로 다시 로그인해 주세요.',
      formTitle: '새 비밀번호 설정',
      formDescription: '12자 이상 128자 이하의 새 비밀번호를 입력해 주세요.',
      submit: '비밀번호 변경'
    },
    verify: {
      invalidTitle: '유효하지 않은 이메일 인증 링크',
      missingToken:
        '인증 토큰이 없습니다. 로그인 화면에서 인증 메일을 다시 요청해 주세요.',
      successTitle: '이메일 인증을 완료했습니다',
      successDescription:
        '이제 가입한 이메일과 비밀번호로 로그인할 수 있습니다.',
      title: '이메일 주소 확인',
      description:
        '아래 버튼을 누르면 이메일 주소 인증을 완료합니다. 링크를 직접 열기만 해서는 계정 상태가 변경되지 않습니다.',
      submit: '이메일 인증하기'
    },
    guest: {
      eyebrow: 'GUEST',
      title: '가입 없이 먼저 체험',
      descriptionMock:
        '랜덤 문제풀이와 결과 확인을 바로 시작할 수 있습니다. 게스트 기록은 계정에 자동 합쳐지지 않으며 오답노트와 즐겨찾기는 로그인 후 사용할 수 있습니다.',
      descriptionReal:
        'RANDOM 문제풀이와 결과 확인을 바로 시작할 수 있습니다. 로그인하면 이후 학습의 오답노트와 전체 학습 기록을 이어서 확인할 수 있습니다.',
      loading: '게스트 세션 준비 중…',
      continue: '게스트로 계속'
    },
    mockNotice: {
      title: 'Mock 데모 계정',
      limitation:
        '회원가입·이메일 인증·비밀번호 재설정은 VITE_API_MODE=real인 실제 API 모드에서 확인해 주세요.'
    },
    validation: {
      email: '올바른 이메일 주소를 입력해 주세요.',
      nameRequired: '이름을 입력해 주세요.',
      nameMax: '이름은 80자 이하로 입력해 주세요.',
      passwordMin: '비밀번호는 12자 이상이어야 합니다.',
      passwordMax: '비밀번호는 128자 이하여야 합니다.',
      newPasswordMin: '새 비밀번호는 12자 이상이어야 합니다.',
      newPasswordMax: '새 비밀번호는 128자 이하여야 합니다.'
    }
  },
  practice: {
    name: '문제풀이'
  },
  result: {
    name: '학습 결과'
  },
  dashboard: {
    name: '학습 대시보드'
  },
  wrongNote: {
    name: '오답노트'
  },
  bookmark: {
    name: '즐겨찾기'
  },
  admin: {
    name: '관리자'
  },
  errors: {
    forbidden: {
      eyebrow: '403 · 접근 권한 없음',
      title: '이 페이지를 볼 권한이 없습니다',
      description:
        '관리자 계정이 필요한 화면입니다. 데모 관리자로 로그인해 주세요.',
      action: '로그인 선택으로 이동'
    },
    notFound: {
      eyebrow: '404 · 찾을 수 없음',
      title: '요청한 페이지가 없습니다',
      description: '주소를 확인하거나 홈에서 다시 시작해 주세요.'
    },
    route: {
      eyebrow: '페이지 오류',
      title: '화면을 불러오지 못했습니다',
      fallback: '예상하지 못한 오류가 발생했습니다.'
    },
    authStatus: {
      title: '로그인 상태를 확인할 수 없습니다',
      description:
        '서버에서 로그인 상태를 확인하지 못했습니다. 저장된 계정 정보는 권한 판단에 사용하지 않았습니다.'
    },
    banner: {
      offline: '오프라인 상태입니다. 네트워크 연결을 확인해 주세요.',
      restored:
        '네트워크 연결이 복구된 것으로 감지했습니다. 필요한 요청을 다시 시도해 주세요.',
      generic: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      network: '네트워크 연결이 원활하지 않습니다. 다시 시도해 주세요.',
      response: '응답 형식이 올바르지 않습니다. 다시 시도해 주세요.',
      validation: '입력 내용을 확인한 뒤 다시 시도해 주세요.',
      server: '서버 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    }
  },
  a11y: {
    japaneseContent: '일본어 학습 콘텐츠'
  }
} as const
