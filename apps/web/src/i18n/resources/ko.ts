export const koResources = {
  common: {
    appName: 'JLPT Drill Note',
    tagline: '풀고, 남기고, 다시',
    locale: {
      label: '언어',
      ko: '한국어',
      ja: '日本語'
    },
    explanation: {
      languageLabel: '해설 언어',
      japaneseUnavailable: '일본어 해설이 없어 한국어 해설을 표시합니다.'
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
    taxonomy: {
      subjects: {
        VOCABULARY: '문자·어휘',
        GRAMMAR: '문법',
        READING: '독해'
      },
      studyModes: {
        RANDOM: '일반 연습',
        WRONG_NOTE: '오답',
        WEAKNESS: '약점 연습',
        BOOKMARK: '즐겨찾기',
        DAILY_REVIEW: '오늘 복습'
      },
      questionTypes: {
        KANJI_READING: '한자 읽기',
        ORTHOGRAPHY: '표기',
        CONTEXT_VOCABULARY: '문맥 어휘',
        PARAPHRASE: '유의 표현',
        WORD_USAGE: '용법',
        GRAMMAR_SELECT: '문법 선택',
        SENTENCE_ORDER: '문장 배열',
        TEXT_GRAMMAR: '글의 문법',
        SHORT_READING: '단문 독해',
        MEDIUM_READING: '중문 독해',
        LONG_READING: '장문 독해',
        INFO_RETRIEVAL: '정보 검색'
      },
      wrongNoteStatuses: {
        NEW: '새 오답',
        REVIEWING: '복습 중',
        AGAIN: '다시 학습',
        SOLVED: '해결'
      },
      availability: {
        AVAILABLE: '현재 출제 가능',
        ARCHIVED: '보관된 문제'
      },
      roles: {
        GUEST: '게스트',
        USER: '학습자',
        ADMIN: '관리자'
      }
    },
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
    name: '문제풀이',
    setup: {
      eyebrow: 'PRACTICE SETUP',
      title: '오늘 풀 문제를 설정하세요',
      description:
        '출제 가능한 문제가 부족하면 가능한 수만 제공하고 실제 문항 수를 알려드립니다.',
      currentRole: '현재 역할: {{role}}',
      resume: {
        title: '이어서 풀기',
        description:
          '서버에 저장된 진행 중 세션을 최신 작업본부터 보여드립니다.',
        refreshing: '목록 갱신 중…',
        guestHint:
          '새 게스트 세션을 시작하면 이 탭에서 서버 작업본을 이어서 풀 수 있습니다. 로그인하면 다른 기기에서도 같은 계정의 작업본을 확인할 수 있습니다.',
        loading: '저장된 작업본을 확인하고 있습니다…',
        offline:
          '오프라인입니다. 연결되면 이어풀기 목록을 자동으로 다시 확인합니다.',
        cachedOffline:
          '오프라인이라 마지막으로 확인한 목록을 표시합니다. 연결될 때까지 취소와 페이지 이동은 잠깁니다.',
        stale:
          '최신 이어풀기 목록으로 갱신하지 못했습니다. 마지막으로 확인한 목록을 유지합니다.',
        error: '이어풀기 목록을 불러오지 못했습니다.',
        empty:
          '저장된 진행 중 작업본이 없습니다. 아래에서 새 학습을 시작해 주세요.',
        summary:
          '{{formattedCount}}문제 · 현재 {{formattedOrdinal}}번 · revision {{formattedRevision}}',
        lastSaved: '마지막 저장 {{date}}',
        notSaved: '아직 서버 저장 전',
        legacyUnavailable:
          '이 세션은 다른 기기의 로컬 답안을 복원할 수 없습니다. 새 학습을 시작하거나 세션을 취소해 주세요.',
        action: '이어서 풀기',
        cancel: '세션 취소',
        paginationLabel: '이어풀기 페이지'
      },
      steps: {
        level: '1. 급수',
        subject: '2. 과목',
        count: '3. 문제 수',
        mode: '4. 출제 모드'
      },
      questionCount: '{{formattedCount}}문제',
      modes: {
        RANDOM: {
          label: '랜덤 문제',
          description: '선택한 급수와 과목에서 무작위로 출제합니다.'
        },
        WRONG_NOTE: {
          label: '오답 문제',
          description: '아직 해결하지 못한 오답을 우선 출제합니다.'
        },
        WEAKNESS: {
          label: '약점 추천',
          description: '최근 제출에서 안정적으로 자주 틀린 문제를 우선합니다.'
        },
        BOOKMARK: {
          label: '즐겨찾기',
          description: '저장한 문제만 모아 다시 풉니다.'
        },
        DAILY_REVIEW: {
          label: '오늘의 복습',
          description: '서버 일정상 오늘 복습할 오답을 순서대로 풉니다.'
        }
      },
      loginRequired: '로그인 후 이용 가능',
      protectedMode:
        '선택한 모드는 로그인 후 이용할 수 있습니다. 랜덤 문제로 바꾸지 않았습니다.',
      login: '로그인하기',
      noEligibleTitle: '현재 조건에는 출제 가능한 {{mode}} 문제가 없습니다.',
      noEligibleDescription:
        '급수·과목·모드를 바꾸거나 랜덤 문제를 선택해 주세요. 서버가 다른 모드로 자동 대체하지는 않습니다.',
      selectRandom: '랜덤 문제 선택',
      createError:
        '세션을 만들지 못했습니다. 네트워크 상태와 선택 조건을 확인한 뒤 다시 시도해 주세요.',
      authorityNote:
        '서버 권위 출제 모드는 후보가 부족해도 다른 모드로 자동 대체하지 않습니다.',
      start: '학습 시작하기',
      cancelDialog: {
        title: '진행 중 세션을 취소할까요?',
        description:
          '취소하면 서버 작업본은 삭제되며 이 세션에는 더 이상 답안을 저장하거나 제출할 수 없습니다.',
        keep: '계속 보관',
        confirm: '세션 취소',
        error:
          '세션을 취소하지 못했습니다. 상태를 새로 확인한 뒤 다시 시도해 주세요.'
      }
    },
    session: {
      loading: {
        questions: '문제를 준비하고 있습니다…',
        guestOwnership: '게스트 세션 소유권을 확인하고 있습니다…',
        resultRedirect: '제출 결과로 이동하고 있습니다…',
        draft: '서버 작업본을 확인하고 있습니다…'
      },
      recovery: {
        title: '이전 제출 결과 확인이 필요합니다',
        pendingDescription:
          '응답 손실 가능성이 있어 이 세션에서 이동하거나 답안을 바꿀 수 없습니다. 연결이 복구되면 세션 상태를 자동으로 다시 확인합니다.',
        failedDescription:
          '응답 손실 가능성이 있어 이 세션에서 이동하거나 답안을 바꿀 수 없습니다. 네트워크 상태를 확인한 뒤 세션을 다시 불러와 동일 답안으로 계속해 주세요.',
        retry: '세션 상태 다시 확인',
        checkingStatus:
          '세션 상태를 불러오는 중입니다. 결과를 확인할 때까지 이 화면에 머물러 주세요.',
        connectedStatus:
          '네트워크가 연결되어 있습니다. 세션 상태를 다시 확인해 주세요.'
      },
      errors: {
        sessionLoadTitle: '학습 세션을 불러오지 못했습니다',
        sessionLoadDescription:
          '세션 주소를 확인하거나 새 학습을 시작해 주세요.',
        offlineSessionDescription:
          '오프라인입니다. 연결되면 학습 세션을 자동으로 다시 확인합니다.',
        cachedOfflineDescription:
          '오프라인입니다. 현재 문제와 답안을 유지하지만 연결이 복구될 때까지 변경하거나 제출할 수 없습니다.',
        staleSessionDescription:
          '학습 세션의 최신 상태를 확인하지 못했습니다. 현재 문제와 답안은 유지되며 다시 확인할 때까지 변경하거나 제출할 수 없습니다.',
        retrySession: '학습 세션 다시 확인',
        draftLoadTitle: '서버 작업본을 불러오지 못했습니다',
        draftLoadDescription:
          '답안을 화면에 복원하기 전에 세션 소유권과 최신 revision을 확인해야 합니다. 연결을 확인한 뒤 다시 시도해 주세요.',
        emptyTitle: '출제할 문제가 없습니다',
        emptyDescription: '다른 급수, 과목 또는 출제 모드를 선택해 주세요.'
      },
      terminal: {
        expiredTitle: '만료된 학습 세션입니다',
        cancelledTitle: '취소된 학습 세션입니다',
        description:
          '새 RANDOM 학습을 시작해 주세요. 이 세션에는 답안을 제출할 수 없습니다.',
        openSetup: '학습 설정으로 이동'
      },
      navigationGuard: {
        title: '작업본을 저장하고 이동할까요?',
        description:
          '현재 문항의 답과 경과 시간을 서버에 저장한 뒤 요청한 화면으로 이동합니다.',
        continue: '계속 풀기',
        saveAndLeave: '저장하고 이동'
      },
      header: {
        progressSummary:
          '현재 {{current}}번 / 전체 {{total}}문제 · 답변 {{answered}}문제',
        elapsedTime: '경과 시간'
      },
      draft: {
        status: {
          remoteDeferred:
            '다른 탭의 최신 저장을 감지했습니다. 현재 저장 응답을 확인한 뒤 안전하게 병합합니다.',
          conflictPending:
            '다른 탭의 저장을 감지했습니다. 로컬 작업을 보존한 채 충돌을 확인합니다.',
          dirty: '변경 내용을 이 탭에 임시 보관했습니다.',
          saving: '변경 내용을 서버에 저장하고 있습니다.',
          savedAt: '서버에 저장했습니다. 마지막 저장 {{time}}',
          saved: '서버와 동기화했습니다.',
          offline:
            '오프라인입니다. 변경 내용은 이 기기에만 임시 보관되며 연결 후 다시 저장합니다.',
          conflict:
            '다른 기기의 변경과 충돌했습니다. 서버 또는 로컬 기록을 선택해 주세요.',
          error:
            '저장하지 못했습니다. 선택한 답은 유지되며 다시 시도할 수 있습니다.',
          synced: '서버 작업본과 동기화되어 있습니다.'
        },
        conflictCheckPending:
          '최신 서버 작업본을 확인하는 동안 답안 저장과 제출을 잠시 멈춥니다.',
        retry: '작업본 저장 다시 시도',
        notices: {
          saveBeforeLeaveFailed: '작업본을 저장하지 못해 현재 화면에 머뭅니다.',
          conflictRefreshComplete:
            '최신 서버 작업본을 확인했습니다. 충돌 항목을 확인한 뒤 다시 제출해 주세요.',
          sessionRefreshFailed: '최신 세션 상태를 확인하지 못했습니다.',
          submissionPreparationFailed:
            '서버 작업본을 저장하지 못해 제출하지 않았습니다.',
          retrySaveFailed:
            '작업본을 다시 저장하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'
        }
      },
      supply: {
        canonicalPartial:
          '요청한 {{requested}}문제 중 {{mode}} 모드로 출제 가능한 {{actual}}문제만 제공합니다. 다른 모드로 대체하지 않았습니다.',
        legacyFallback:
          '레거시 세션에서 선택한 모드의 문제가 부족해 랜덤 문제를 함께 제공합니다.',
        canonicalNoFallback: '서버 권위 세션은 다른 모드로 대체하지 않습니다.'
      },
      progressLabel: '문제풀이 진행률 {{percent}}%',
      question: {
        passageEyebrow: 'READING PASSAGE',
        passageLabel: '독해 지문',
        numberLabel: '{{ordinal}}번 문제.',
        answerLegend: '정답 보기',
        keyboardHint:
          '숫자 1–4로 답을 선택하고, ← → 키로 문제를 이동하며, 마지막 문제에서 Ctrl+⏎ 또는 ⌘+⏎로 제출 확인을 열 수 있습니다.'
      },
      bookmark: {
        add: '즐겨찾기',
        remove: '즐겨찾기 해제',
        addLabel: '{{ordinal}}번 문제 즐겨찾기 추가',
        removeLabel: '{{ordinal}}번 문제 즐겨찾기 해제',
        loginRequired: '즐겨찾기를 저장하려면 로그인해 주세요.',
        legacyReadOnly: '이전 계약 세션에서는 즐겨찾기를 변경할 수 없습니다.',
        removed: '즐겨찾기에서 해제했습니다.',
        removeRollback: '즐겨찾기 해제를 완료하지 못해 복원했습니다.',
        saved: '즐겨찾기에 저장했습니다.',
        saveRollback: '즐겨찾기를 저장하지 못해 이전 상태로 복원했습니다.',
        offlineQueued:
          '오프라인입니다. 연결되면 즐겨찾기 변경을 다시 시도합니다.',
        statusLoadOffline:
          '오프라인이라 즐겨찾기 상태를 확인할 수 없습니다. 연결되면 자동으로 다시 확인합니다.',
        statusLoadFailed: '즐겨찾기 상태를 확인하지 못했습니다.',
        retryStatus: '다시 확인',
        chooseLogin: '로그인 선택'
      },
      navigation: {
        previous: '이전',
        next: '다음',
        submit: '답안 제출',
        jumpLabel: '문제 바로가기',
        jumpQuestionAnswered: '{{ordinal}}번 문제, 답변함',
        jumpQuestionUnanswered: '{{ordinal}}번 문제, 미응답'
      },
      submit: {
        title: '답안을 제출하시겠습니까?',
        frozenDescription:
          '이전에 전송한 답안을 그대로 다시 제출합니다. 결과를 확인할 때까지 답안은 변경할 수 없습니다.',
        unansweredDescription:
          '아직 답하지 않은 문제가 {{unanswered}}개 있습니다. 미응답은 오답으로 처리됩니다.',
        completeDescription:
          '모든 문제에 답했습니다. 제출 후에는 답을 수정할 수 없습니다.',
        continue: '계속 풀기',
        confirm: '제출하고 결과 보기',
        frozenFailure:
          '결과를 확인하지 못했습니다. 네트워크 상태를 확인한 뒤 동일 답안으로 다시 시도해 주세요.',
        requestFailure:
          '제출 요청이 처리되지 않았습니다. 입력과 세션 상태를 확인한 뒤 다시 시도해 주세요.',
        connectivity: {
          offline:
            '오프라인 상태입니다. 연결이 복구되면 동일 답안으로 다시 시도해 주세요.',
          restored:
            '네트워크 연결이 복구되었습니다. 동일 답안으로 다시 시도할 수 있습니다.'
        }
      },
      conflict: {
        title: '다른 기기의 작업과 충돌했습니다',
        description:
          '{{conflicts}}개 항목의 변경이 서로 다릅니다. 자동으로 덮어쓰지 않고 선택한 기록을 기준으로 이어갑니다.',
        useServer: '서버 기록 사용',
        keepLocal: '내 변경 유지',
        detail:
          '서버 기록을 선택하면 이 탭의 충돌 변경을 버립니다. 내 변경을 선택하면 최신 revision 위에 다시 저장합니다.'
      }
    }
  },
  result: {
    name: '학습 결과',
    loading: '채점 결과를 불러오고 있습니다…',
    error: {
      title: '학습 결과를 불러오지 못했습니다',
      description: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
      offlineTitle: '오프라인에서 학습 결과를 기다리고 있습니다',
      offlineDescription:
        '연결되면 학습 결과와 세션 상태를 자동으로 다시 확인합니다.',
      cachedOffline:
        '오프라인이라 마지막으로 확인한 학습 결과를 표시합니다. 연결될 때까지 결과 기반 동작은 잠깁니다.',
      staleDescription:
        '최신 결과로 갱신하지 못해 마지막으로 확인한 결과를 표시합니다. 다시 확인할 때까지 결과 기반 동작은 잠깁니다.'
    },
    notFound: {
      title: '학습 결과를 찾을 수 없습니다',
      description: '아직 제출하지 않은 세션이거나 만료된 학습 기록입니다.',
      retrySourceDescription:
        '재출제할 원본 결과가 없거나 현재 계정에서 접근할 수 없습니다.'
    },
    newPractice: '새 문제 풀기',
    description: '정답과 해설을 확인하고 틀린 문제를 다음 복습으로 연결하세요.',
    metrics: {
      total: '전체',
      correct: '정답',
      incorrect: '오답',
      accuracy: '정답률',
      duration: '소요 시간',
      durationValue: '{{minutes}}분 {{seconds}}초'
    },
    status: {
      guest:
        '현재 게스트 세션에서는 오답을 다시 풀 수 있지만 계정 오답노트에는 저장되지 않습니다.',
      savedWrongCount:
        '틀린 {{formattedCount}}문제가 오답노트에 반영되었습니다.'
    },
    actions: {
      retryIncorrect: '오답만 다시 풀기',
      loginChoice: '로그인 선택',
      openWrongNotes: '오답노트 보기'
    },
    retry: {
      checking: '결과 확인 중…',
      waitingConnection: '연결 대기 중…',
      creating: '재출제 중…',
      noEligibleTitle: '현재 다시 풀 수 있는 오답이 없습니다',
      noEligibleDescription:
        '문제가 보관 처리됐거나 재출제 가능한 고정 버전이 남아 있지 않습니다.',
      unsupported:
        '이 결과 형식에서는 오답 재출제를 지원하지 않습니다. 새 문제 풀기로 학습을 이어가 주세요.',
      allCorrectTitle: '다시 풀 오답이 없습니다',
      allCorrectDescription:
        '모든 문제를 맞혔습니다. 새 문제로 학습을 이어가세요.',
      offline: '오프라인입니다. 연결되면 같은 재출제 키로 요청을 이어갑니다.',
      errorTitle: '오답 재출제 세션을 만들지 못했습니다.',
      errorDescription:
        '네트워크 상태를 확인한 뒤 같은 버튼으로 다시 시도해 주세요.',
      priorEnded:
        '이전에 만든 오답 재출제 세션이 종료됐습니다. 다시 누르면 새 세션을 만듭니다.',
      sourceRefreshing: '원본 학습 결과의 현재 상태를 다시 확인하고 있습니다.'
    },
    items: {
      title: '문제별 결과',
      correct: '정답',
      incorrect: '오답',
      ordinal: '{{formattedOrdinal}}번',
      selectedAnswer: '내가 선택한 답',
      unanswered: '미응답',
      correctAnswer: '정답',
      correctAnswerUnavailable: '정답 정보 없음',
      explanation: '해설'
    },
    bookmark: {
      offline: '오프라인입니다. 연결되면 즐겨찾기 변경을 다시 시도합니다.',
      loadOffline:
        '오프라인이라 즐겨찾기 상태를 확인할 수 없습니다. 연결되면 자동으로 다시 확인합니다.',
      loadError: '즐겨찾기 상태를 확인하지 못했습니다.',
      retry: '다시 확인',
      add: '즐겨찾기',
      addLabel: '{{formattedOrdinal}}번 문제 즐겨찾기 추가',
      remove: '즐겨찾기 해제',
      removeLabel: '{{formattedOrdinal}}번 문제 즐겨찾기 해제',
      unavailable: '이 결과에서는 즐겨찾기를 변경할 수 없습니다.',
      removed: '즐겨찾기에서 해제했습니다.',
      removeFailed: '즐겨찾기 해제를 완료하지 못해 복원했습니다.',
      saved: '즐겨찾기에 저장했습니다.',
      saveFailed: '즐겨찾기를 저장하지 못해 이전 상태로 복원했습니다.'
    },
    blocker: {
      title: '오답 재출제 요청을 처리하고 있습니다',
      description:
        '요청 결과를 확인한 뒤 새 학습 세션으로 자동 이동합니다. 잠시 현재 화면에 머물러 주세요.',
      stay: '현재 화면에 머물기'
    }
  },
  dashboard: {
    name: '학습 대시보드',
    loading: '학습 대시보드를 불러오고 있습니다…',
    offline: {
      title: '오프라인에서 대시보드를 기다리고 있습니다',
      description:
        '연결되면 누적 통계와 최근 인사이트를 자동으로 다시 불러옵니다.'
    },
    eyebrow: 'DASHBOARD',
    title: '학습 흐름을 확인하세요',
    greeting: '{{name}}님의 목표 급수는 {{level}}입니다.',
    learnerFallback: '학습자',
    targetUnset: '미설정',
    basisNote:
      '누적 수치는 전체 기간 기준이며, 최근 7일 날짜는 UTC 기준입니다.',
    startToday: '오늘 학습 시작',
    summary: {
      loading: '누적 학습 통계를 불러오고 있습니다…',
      offlineTitle: '오프라인에서 누적 통계를 기다리고 있습니다',
      offlineDescription: '연결되면 누적 학습 통계를 자동으로 다시 확인합니다.',
      staleTitle: '최신 누적 통계로 갱신하지 못했습니다',
      staleDescription: '현재 화면에는 마지막으로 확인한 결과를 유지합니다.',
      cachedOffline:
        '오프라인이라 마지막으로 확인한 누적 통계를 표시합니다. 연결되면 자동으로 다시 확인합니다.',
      retry: '누적 통계 다시 시도',
      errorTitle: '누적 대시보드를 불러오지 못했습니다',
      errorDescription:
        '최근 90일 인사이트는 별도로 확인할 수 있습니다. 누적 통계만 다시 요청해 주세요.',
      emptyTitle: '아직 학습 기록이 없습니다',
      emptyDescription:
        '첫 문제를 풀면 정답률, 약한 과목, 최근 7일 학습량이 이곳에 표시됩니다.',
      emptyAction: '첫 학습 시작하기',
      totalAnswered: '전체 풀이',
      correctRate: '전체 정답률',
      wrongNotes: '누적 오답',
      solvedWrongNotes: '해결한 오답',
      weakestSubject: '가장 약한 과목',
      analysisPending: '분석 대기',
      questionUnit: '문제',
      itemUnit: '개',
      subjectAccuracy: '과목별 정답률',
      subjectAccuracyLabel: '{{subject}} 정답률',
      recentSevenDays: '최근 7일 학습량',
      recentSevenDaysLabel: '최근 7일 문제 풀이 수',
      chartDescription:
        '차트의 숫자와 날짜를 함께 제공해 색상이나 막대 높이에만 의존하지 않습니다.',
      recentSessions: '최근 학습 기록',
      recentSessionResult: '{{correct}}/{{total}} 정답',
      sessionAccuracy: '정답률 {{rate}}%',
      noRecentSessions: '최근 세션이 없습니다.',
      repeatedWrong: '반복 오답 상위 문제',
      openReviewCenter: '복습 센터에서 보기',
      wrongCount: '{{formattedCount}}회 오답',
      noRepeatedWrong: '반복해서 틀린 문제가 없습니다.'
    },
    insights: {
      loading: '최근 90일 인사이트를 불러오고 있습니다…',
      offlineTitle: '오프라인에서 최근 인사이트를 기다리고 있습니다',
      offlineDescription:
        '연결되면 최근 90일 학습 인사이트를 자동으로 다시 확인합니다.',
      errorTitle: '학습 인사이트를 불러오지 못했습니다',
      errorDescription:
        '기존 누적 통계는 그대로 확인할 수 있습니다. 최근 90일 분석만 다시 요청해 주세요.',
      retry: '최근 인사이트 다시 시도',
      eyebrow: 'LAST 90 DAYS',
      title: '약점과 다음 학습 추천',
      window:
        '{{formattedDays}}일 기록 · 최소 {{formattedAttempts}}회 표본 · {{observedAt}} 기준',
      ruleBased: '규칙 기반 추천',
      staleTitle: '최신 인사이트로 갱신하지 못했습니다',
      staleDescription: '현재 화면에는 마지막으로 확인한 결과를 유지합니다.',
      cachedOffline:
        '오프라인이라 마지막으로 확인한 추천을 표시합니다. 연결될 때까지 추천 실행은 잠깁니다.',
      recentAttempts: '최근 풀이',
      recentAccuracy: '최근 정답률',
      averageTime: '평균 풀이 시간',
      dueReview: '복습 예정',
      repeatedWrong: '반복 오답',
      questionUnit: '문제',
      byLevel: '급수별 정답률',
      chartDescription: '막대와 같은 수치를 아래 표에서도 확인할 수 있습니다.',
      chartLoading: '급수별 정답률 차트를 불러오는 중입니다…',
      levelTableLabel: '최근 90일 급수별 정답률 상세 표',
      levelTableTitle: '급수별 상세 수치',
      subjectTableLabel: '최근 90일 과목별 정답률 상세 표',
      subjectTableTitle: '과목별 통계',
      detailsSummary: '유형·태그 세부 통계 보기',
      detailsLabel: '세부 통계 종류',
      questionType: '문제 유형',
      questionTypeTableLabel: '최근 90일 문제 유형별 정답률 상세 표',
      questionTypeTableTitle: '문제 유형별 통계',
      tag: '태그',
      tagTableLabel: '최근 90일 태그별 정답률 상세 표',
      tagTableTitle: '태그별 통계',
      noTags: '관측된 태그가 없습니다.',
      tagTruncated:
        '태그 전체 {{formattedTotal}}개 중 최대 {{formattedLimit}}개를 표시합니다.',
      emptyTitle: '최근 90일 학습 기록이 없습니다',
      emptyDescription:
        '문제를 풀면 급수·과목·유형·태그별 정확도와 평균 풀이 시간이 표시됩니다. 표본이 없는 값은 0%가 아니라 ‘표본 없음’으로 구분합니다.',
      weaknesses: '분석된 약점',
      count: '{{formattedCount}}개',
      noWeaknessTitle: '분석 기준을 충족한 약점이 없습니다',
      noWeaknessDescription:
        '같은 분류에서 최소 {{formattedAttempts}}회 표본이 쌓이고 오답이 있어야 약점으로 표시합니다.',
      recommendations: '다음 학습 추천',
      actionLoading: '추천 학습 준비 중…',
      actionAriaLabel: '{{action}}: {{summary}}',
      table: {
        caption: '{{title}} 표',
        category: '구분',
        attempted: '풀이',
        correct: '정답',
        accuracy: '정답률',
        averageTime: '평균 시간',
        recent: '최근 학습',
        attemptCount: '{{formattedCount}}회'
      },
      projection: {
        noSample: '표본 없음',
        noLearningRecord: '학습 기록 없음',
        seconds: '{{value}}초',
        weaknessDetail:
          '{{attempted}}회 중 {{incorrect}}회 오답 · 정답률 {{accuracy}} · 최근 {{days}}일',
        weaknessScore: '약점 점수 {{score}}',
        targetedSummary: '반복 오답 1문제 집중 복습',
        openSetupSummary: '연습 조건 설정 열기',
        sessionSummary:
          '{{mode}} · {{level}} {{subject}} · {{formattedCount}}문제',
        startMode: '{{mode}} 시작하기',
        startTargeted: '이 문제만 복습하기',
        openSetup: '연습 조건 설정 열기',
        recommendation: {
          DUE_REVIEW: {
            title: '오늘 복습부터 시작하세요',
            reason:
              '{{level}} {{subject}} 복습 예정 문제가 {{formattedCount}}개 있습니다. 가장 이른 예정 시각은 {{date}}입니다.'
          },
          REPEATED_WRONG: {
            title: '반복해서 틀린 문제를 다시 확인하세요',
            reasonPrefix: '“',
            reasonSuffix:
              '” 문제를 {{formattedCount}}회 틀렸습니다. 마지막 오답은 {{date}}입니다.'
          },
          RECENT_LOW_ACCURACY_TYPE: {
            title: '최근 정확도가 낮은 유형을 연습하세요',
            reason:
              '{{level}} {{subject}}의 {{questionType}} 유형에서 {{attempted}}회 중 {{incorrect}}회 틀렸습니다. 정답률은 {{accuracy}}입니다.'
          },
          STALE_WEAK_SUBJECT: {
            title: '오래 쉬었던 약한 과목을 다시 잡아보세요',
            reason:
              '{{level}} {{subject}}의 마지막 약점 근거가 {{days}}일 전입니다. {{attempted}}회 중 {{incorrect}}회 틀렸습니다.'
          },
          TARGET_LEVEL_PRACTICE: {
            title: '목표 급수의 다음 문제를 풀어보세요',
            reason:
              '{{level}} {{subject}} 문제 {{catalogCount}}개 중 {{nonRecentCount}}개가 최근 3개 세션 밖에 있어 우선 연습할 수 있습니다.'
          },
          PRACTICE_SETUP_TARGET: {
            title: '목표 급수를 먼저 설정해 주세요',
            reason:
              '목표 급수가 정해지면 현재 공개된 문제 안에서 다음 연습을 추천합니다.'
          },
          PRACTICE_SETUP_CATALOG: {
            title: '연습 조건을 다시 선택해 주세요',
            reason:
              '현재 목표 급수에 공개된 문제가 없어 다른 급수나 과목을 선택해야 합니다.'
          }
        },
        personalization: {
          NO_PERSONALIZED_EVIDENCE:
            '개인화 근거가 아직 충분하지 않아 목표 급수의 일반 연습을 함께 추천합니다.',
          TARGET_LEVEL_NOT_SET: '목표 급수가 없어 연습 조건 설정을 안내합니다.',
          NO_TARGET_CATALOG:
            '현재 목표 급수에 공개된 문제가 없어 연습 조건 설정을 안내합니다.'
        }
      },
      actionNotice: {
        sessionExhausted:
          '추천 시점 이후 출제 가능한 문제가 없어 이 학습을 시작하지 못했습니다. 요청한 모드는 다른 모드로 바꾸지 않았으며 최신 추천을 확인하는 중입니다.',
        sessionRefreshed:
          '요청한 모드는 다른 모드로 바꾸지 않았으며 최신 추천을 새로 확인했습니다.',
        sessionRefreshFailed:
          '요청한 모드는 다른 모드로 바꾸지 않았습니다. 최신 추천을 불러오지 못해 이 추천은 잠시 비활성화했습니다. 최근 인사이트를 다시 시도해 주세요.',
        sessionFailed:
          '추천 학습을 시작하지 못했습니다. 다른 모드로 자동 변경하지 않았습니다. 같은 추천을 다시 시도해 주세요.',
        targetedEnded:
          '이전에 만든 단일 복습 세션이 이미 종료됐습니다. 다른 학습으로 바꾸지 않고 최신 추천을 확인하는 중입니다.',
        targetedEndedRefreshed:
          '종료된 단일 복습을 다른 학습으로 바꾸지 않고 최신 추천을 새로 확인했습니다.',
        targetedEndedRefreshFailed:
          '종료된 단일 복습을 다른 학습으로 바꾸지 않았습니다. 최신 추천을 불러오지 못해 이 추천은 잠시 비활성화했습니다. 최근 인사이트를 다시 시도해 주세요.',
        targetedUnavailable:
          '추천한 문제가 더 이상 복습 가능하지 않습니다. 다른 학습으로 자동 변경하지 않았으며 최신 추천을 확인하는 중입니다.',
        targetedRefreshed:
          '다른 학습으로 자동 변경하지 않았으며 최신 추천을 새로 확인했습니다.',
        targetedRefreshFailed:
          '다른 학습으로 자동 변경하지 않았습니다. 최신 추천을 불러오지 못해 이 추천은 잠시 비활성화했습니다. 최근 인사이트를 다시 시도해 주세요.',
        targetedFailed:
          '단일 복습을 시작하지 못했습니다. 다른 학습으로 자동 변경하지 않았습니다. 같은 추천을 다시 시도해 주세요.'
      }
    }
  },
  wrongNote: {
    name: '오답노트',
    history: {
      eyebrow: 'WRONG NOTE',
      title: '전체 오답 기록',
      description:
        '마지막으로 틀린 문제 버전과 당시 상태를 보존한 historical archive입니다.',
      backToCenter: '복습 센터로 돌아가기',
      filters: {
        level: '급수',
        allLevels: '전체 급수',
        subject: '과목',
        allSubjects: '전체 과목',
        status: '상태',
        allStatuses: '전체 상태',
        tag: '태그',
        allTags: '전체 태그',
        sort: '정렬',
        recent: '최근 오답순',
        mostWrong: '많이 틀린 순',
        oldest: '오래된 순'
      },
      states: {
        offline:
          '오프라인입니다. 연결이 복구되면 현재 URL 조건으로 전체 오답 기록을 자동으로 다시 불러옵니다.',
        loading: '오답노트를 불러오고 있습니다…',
        errorTitle: '오답노트를 불러오지 못했습니다',
        errorDescription: '잠시 후 다시 시도해 주세요.',
        stale:
          '전체 오답 기록의 최신 상태를 확인하지 못했습니다. 현재까지 불러온 기록은 유지됩니다.',
        retryStale: '전체 오답 기록 다시 확인',
        correctingPage: '유효한 오답노트 페이지로 이동하고 있습니다…',
        emptyTitle: '아직 조건에 맞는 오답이 없습니다',
        emptyDescription: '문제를 풀고 틀린 항목은 자동으로 이곳에 저장됩니다.',
        start: '첫 문제 풀기'
      },
      results: {
        count: '오답 {{formattedCount}}개',
        resetFilters: '필터 초기화',
        wrongCount: '{{formattedCount}}회 오답',
        questionType: '문제 유형',
        lastWrong: '마지막 오답',
        archived: '보관된 문제 · 재풀이 불가',
        available: '현재 출제 가능 · 상세에서 단일 복습 가능',
        detail: '상세 보기'
      }
    },
    center: {
      eyebrow: 'REVIEW CENTER',
      title: '지금 복습할 오답을 확인하세요',
      description:
        '서버 복습 일정과 현재 출제 가능한 문제 버전을 기준으로 정렬합니다.',
      history: '전체 오답 기록',
      views: {
        DUE: '복습 예정',
        UNREVIEWED: '아직 복습 전',
        REPEATED: '반복 오답',
        SOLVED: '해결'
      },
      filters: {
        level: '급수',
        allLevels: '전체 급수',
        subject: '과목',
        allSubjects: '전체 과목',
        questionType: '문제 유형',
        allQuestionTypes: '전체 유형',
        tag: '태그',
        allTags: '전체 태그',
        sort: '정렬',
        nextReview: '다음 복습순',
        mostWrong: '많이 틀린 순',
        recent: '최근 오답순'
      },
      batch: {
        count: '묶음 문제 수',
        countOption: '{{formattedCount}}문제',
        loading: '복습 세션 준비 중…',
        start: '조건에 맞는 오늘의 복습 시작',
        offline:
          '오프라인에서는 복습 세션을 만들 수 없습니다. 연결 후 같은 조건으로 다시 시도해 주세요.',
        noEligible: '현재 조건으로 출제 가능한 복습 문제가 없습니다.',
        error:
          '복습 세션을 만들지 못했습니다. 입력과 연결 상태를 확인해 주세요.'
      },
      states: {
        offline:
          '오프라인입니다. 연결이 복구되면 현재 URL 조건으로 복습 대기열을 자동으로 다시 불러옵니다.',
        loading: '복습 대기열을 불러오고 있습니다…',
        errorTitle: '복습 대기열을 불러오지 못했습니다',
        errorDescription: '연결 상태를 확인한 뒤 다시 시도해 주세요.',
        stale:
          '복습 대기열의 최신 상태를 확인하지 못했습니다. 현재 결과는 유지되며, 최신성을 확인할 때까지 묶음 복습을 시작할 수 없습니다.',
        retryStale: '복습 대기열 다시 확인',
        correctingPage: '유효한 복습 대기열 페이지로 이동하고 있습니다…'
      },
      results: {
        count: '조건에 맞는 오답 {{formattedCount}}개',
        observedAt: '서버 기준 시각 {{date}}',
        resetFilters: '필터 초기화',
        dueEmptyTitle: '지금 예정된 복습이 없습니다',
        filteredEmptyTitle: '조건에 맞는 오답이 없습니다',
        dueEmptyDescription:
          '전체 기록을 돌아보거나 새로운 문제를 풀어 다음 복습을 준비하세요.',
        filteredEmptyDescription:
          '필터를 바꾸거나 전체 오답 기록을 확인해 보세요.',
        history: '전체 기록',
        setup: '학습 설정',
        hasMemo: '메모 있음',
        wrong: '오답',
        wrongCount: '{{formattedCount}}회',
        streak: '연속 정답',
        nextReview: '다음 복습',
        detail: '상세·메모·복습 기록',
        pagination: '복습 대기열 페이지'
      }
    },
    detail: {
      title: '마지막 오답 문제 상세',
      snapshotNotice:
        '아래 문제·보기·해설은 마지막으로 틀렸을 때 고정된 문제 버전입니다.',
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
        archived: '보관된 문제: 현재 출제 가능한 문제 버전이 없습니다.',
        available:
          '현재 출제 가능한 문제 버전으로 단일 복습을 시작할 수 있습니다.'
      },
      states: {
        coldOfflineTitle: '오프라인에서는 오답 상세를 불러올 수 없습니다',
        coldOfflineDescription:
          '연결이 복구되면 이 문제를 자동으로 다시 불러옵니다.',
        loading: '오답 상세를 불러오고 있습니다…',
        notFoundTitle: '오답을 찾을 수 없습니다',
        notFoundDescription:
          '삭제되었거나 현재 계정에 저장되지 않은 문제입니다.',
        loadErrorTitle: '오답 상세를 불러오지 못했습니다',
        loadErrorDescription: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
        backHistory: '전체 오답 기록으로 돌아가기',
        backDashboard: '학습 대시보드로 돌아가기',
        backCenter: '복습 센터로 돌아가기',
        cachedOffline:
          '오프라인입니다. 현재 저장된 상세를 표시하며 연결되면 서버 상태를 다시 확인합니다.',
        stale:
          '상세의 최신 상태를 확인하지 못했습니다. 표시 중인 내용과 작성 중인 메모는 유지됩니다.',
        retry: '상세 다시 확인'
      },
      targeted: {
        waitingConnection: '연결 대기 중…',
        loading: '단일 복습 준비 중…',
        recover: '기존 단일 복습 복구',
        start: '이 문제만 다시 풀기',
        archivedRecovery:
          '문제는 보관됐지만 이전에 생성된 단일 복습 세션은 같은 요청 키로 복구할 수 있습니다.',
        memoDirty:
          '메모를 저장하거나 변경을 취소한 뒤 단일 복습을 시작해 주세요.',
        offline:
          '오프라인입니다. 연결되면 같은 요청 키로 단일 복습 생성을 이어갑니다.',
        unavailable: '현재 출제 가능한 문제 버전이 없습니다.',
        error: '단일 복습 세션을 만들지 못했습니다. 다시 시도해 주세요.',
        archivedOnly: '보관된 문제는 기록과 메모만 확인할 수 있습니다.',
        endedArchived:
          '이전에 만든 단일 복습 세션이 종료됐습니다. 보관된 문제에서는 새 단일 복습을 시작할 수 없습니다.',
        endedAvailable:
          '이전에 만든 단일 복습 세션이 종료됐습니다. 다시 누르면 새 세션을 만듭니다.'
      },
      memoSection: {
        title: '나의 메모',
        description:
          '메모는 현재 계정의 이 오답에만 저장되며 자동 저장하지 않습니다.'
      },
      timelineSection: {
        title: '복습 타임라인',
        description:
          '최신 기록부터 표시하며 상태와 횟수 변화는 텍스트로 함께 제공합니다.'
      }
    },
    memo: {
      loadingOffline:
        '오프라인에서는 메모를 불러올 수 없습니다. 연결되면 자동으로 다시 불러옵니다.',
      loading: '메모를 불러오고 있습니다…',
      loadError: '메모를 불러오지 못했습니다.',
      cachedOffline:
        '오프라인입니다. 현재 저장된 메모를 표시하며 연결되면 서버 상태를 다시 확인합니다.',
      stale:
        '메모의 최신 상태를 확인하지 못했습니다. 작성 중인 입력은 유지됩니다.',
      retryStale: '메모 다시 확인',
      label: '나의 메모',
      hint: 'trim 후 Unicode 문자 {{current}}/{{maximum}}자 · 메모는 자동 저장되지 않습니다.',
      validation: {
        nul: 'NUL 문자는 메모에 사용할 수 없습니다.',
        tooLong: '메모는 공백을 제외하고 {{maximum}}자 이하여야 합니다.',
        invalidUnicode: '메모에 올바르지 않은 Unicode 문자가 있습니다.'
      },
      saveOffline:
        '오프라인에서는 메모를 저장할 수 없습니다. 입력은 유지됩니다. 연결 후 다시 시도해 주세요.',
      saveError:
        '메모를 저장하지 못했습니다. 입력은 유지됩니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.',
      saved: '메모를 저장했습니다.',
      deleted: '메모를 삭제했습니다.',
      cancelled: '변경 내용을 취소했습니다.',
      saving: '저장 중…',
      deleting: '삭제 중…',
      save: '메모 저장',
      cancel: '변경 취소',
      delete: '메모 삭제',
      deleteDialog: {
        title: '메모를 삭제할까요?',
        description:
          '저장된 메모를 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
        keep: '메모 유지',
        confirm: '메모 삭제'
      },
      leaveDialog: {
        title: '저장하지 않은 메모가 있습니다',
        description: '이 페이지를 나가면 작성 중인 메모가 사라집니다.',
        continue: '계속 작성',
        discard: '변경사항 버리기'
      }
    },
    timeline: {
      sources: {
        STUDY_SUBMIT: '표준 학습 제출',
        WRONG_NOTE_REVIEW: '오답 복습 제출',
        VERSION_REBASE: '문제 버전 전환'
      },
      outcomes: {
        none: '정답 판정 없음',
        correct: '정답',
        incorrect: '오답'
      },
      loadingOffline:
        '오프라인에서는 복습 기록을 불러올 수 없습니다. 연결되면 자동으로 다시 불러옵니다.',
      loading: '복습 기록을 불러오고 있습니다…',
      loadError: '복습 기록을 불러오지 못했습니다.',
      stale:
        '복습 기록의 최신 상태를 확인하지 못했습니다. 현재까지 불러온 기록은 유지됩니다.',
      retryStale: '복습 기록 다시 확인',
      emptyOffline: '오프라인입니다. 연결되면 복습 기록을 다시 확인합니다.',
      empty: '아직 복습 이벤트가 없습니다.',
      cachedOffline:
        '오프라인입니다. 현재 기록을 유지하며 연결되면 중단된 요청을 이어갑니다.',
      statusChange: '상태 변화',
      recordStart: '기록 시작',
      wrongCount: '오답 횟수',
      streak: '연속 정답',
      elapsed: '풀이 시간',
      noRecord: '기록 없음',
      seconds: '{{formattedCount}}초',
      questionVersion: '문제 버전',
      algorithm: '알고리즘',
      algorithmVersion: 'version {{version}}',
      moreError:
        '이전 기록을 더 불러오지 못했습니다. 현재까지 불러온 기록은 유지됩니다.',
      waitingConnection: '연결 대기 중…',
      loadingMore: '이전 기록 불러오는 중…',
      loadMore: '이전 기록 더 보기',
      complete: '첫 오답 기록까지 모두 확인했습니다.'
    }
  },
  bookmark: {
    name: '즐겨찾기',
    loading: '즐겨찾기를 불러오고 있습니다…',
    error: {
      title: '즐겨찾기를 불러오지 못했습니다',
      description: '잠시 후 다시 요청해 주세요.',
      offlineTitle: '오프라인에서 즐겨찾기를 기다리고 있습니다',
      offlineDescription: '연결되면 즐겨찾기 목록을 자동으로 다시 불러옵니다.',
      cachedOffline:
        '오프라인입니다. 현재 목록을 유지하며 연결되면 중단된 요청을 이어갑니다.',
      staleDescription:
        '즐겨찾기의 최신 상태를 확인하지 못했습니다. 현재 목록은 유지됩니다.'
    },
    status: {
      removing: '즐겨찾기 해제를 처리하고 있습니다…',
      removed: '즐겨찾기에서 해제했습니다.',
      restoreFailed: '즐겨찾기 해제를 완료하지 못해 이전 상태로 복원했습니다.',
      offline: '오프라인입니다. 연결되면 즐겨찾기 변경을 다시 시도합니다.'
    },
    eyebrow: 'BOOKMARKS',
    title: '즐겨찾기 문제',
    description:
      '다시 확인하고 싶은 문제를 모아 BOOKMARK 모드로 학습할 수 있습니다.',
    empty: {
      firstTitle: '저장한 문제가 없습니다',
      pageTitle: '이 페이지가 비었습니다',
      firstDescription:
        '문제풀이 화면에서 즐겨찾기를 누르면 이곳에 모아볼 수 있습니다.',
      pageDescription: '이전 페이지에서 즐겨찾기를 확인해 주세요.',
      start: '문제 풀러 가기',
      previousPage: '이전 페이지'
    },
    practice: {
      title: '범위별 즐겨찾기 재풀이',
      description:
        '같은 급수와 과목의 현재 공개 문제를 저장 순서대로 출제합니다.',
      groupAction: '{{level}} · {{subject}} · 최대 {{formattedCount}}문제 풀기',
      allArchived:
        '이 페이지의 즐겨찾기는 모두 보관되어 현재 출제할 수 없습니다.',
      noneAvailable: '선택한 범위에 현재 출제 가능한 즐겨찾기 문제가 없습니다.',
      refresh: '즐겨찾기 목록 새로고침',
      offline: '오프라인입니다. 연결되면 BOOKMARK 학습 생성을 다시 시도합니다.',
      startError:
        'BOOKMARK 학습을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    },
    availability: {
      available: '출제 가능',
      archived: '보관된 문제',
      archivedDescription: '공개가 종료되어 새 학습 세션에는 포함되지 않습니다.'
    },
    remove: '즐겨찾기 해제',
    pagination: {
      label: '즐겨찾기 페이지',
      status: '{{page}} / {{pageCount}} 페이지'
    }
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
        '서버에서 로그인 상태를 확인하지 못했습니다. 저장된 계정 정보는 권한 판단에 사용하지 않았습니다.',
      offlineTitle: '오프라인에서 로그인 상태를 확인할 수 없습니다',
      offlineDescription:
        '연결이 복구되면 로그인 상태를 다시 확인합니다. 저장된 계정 정보는 권한 판단에 사용하지 않았습니다.'
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
