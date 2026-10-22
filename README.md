# 하루마루 · JLPT Drill Note

하루마루는 JLPT N5~N1 문자·어휘, 문법, 독해를 짧게 풀고 오답노트로
반복 학습하는 한국어 중심 웹앱입니다. 문제와 해설은 자체 제작하며,
실제 JLPT 기출문제나 상용 교재 문항을 복제하지 않습니다.

## 주요 기능

- 급수·과목·문제 수를 선택하는 문제풀이와 제출 후 채점·해설
- 오답·약점·책갈피를 활용한 복습과 문제별 메모
- 학습 기록, 정답률, 과목별 통계를 보여 주는 대시보드
- 관리자 문제 검색·등록·수정·삭제 화면
- 한국어·일본어 UI와 모바일 대응 화면
- 로딩·오류·빈 결과·오프라인·접근 권한 상태 처리

## 인증 정책

공개 회원 인증 정책은 **Google 전용**입니다.
자체 이메일·비밀번호 가입은 폐기했으며, Apple 로그인은 보류합니다.

## 저장소 구조

```text
.
├── apps/
│   ├── web/             # Vite·React UI, API 소비, MSW, UI 테스트
│   │   └── src/
│   │       ├── api/     # HTTP 함수와 전송 계약 검증
│   │       ├── app/     # 화면·도메인 훅·Query Factory
│   │       ├── i18n/    # 한국어·일본어 리소스
│   │       ├── mocks/   # 개발·테스트용 Mock API
│   │       └── store/   # 클라이언트 상태
│   └── api/             # Hono API·인증·학습·문항 도메인
├── packages/
│   ├── contracts/       # 공유 전송 계약
│   └── domain/          # 서버 도메인 로직
├── infra/               # PostgreSQL 초기화 구성
├── operations/          # 환경·복구 계약과 운영 절차
├── scripts/             # 아키텍처·보안·운영 검사 도구
├── team/                # 개발 역할과 Git 운영 문서
└── .github/workflows/   # 자동 검사 정의
```

## 로컬 Mock 실행

Node.js **22.23.0**, pnpm **10.2.1**을 사용합니다.
아래 명령은 모두 저장소 루트에서 실행합니다.

```bash
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
pnpm run dev:web
```

Web 개발 주소는 `http://localhost:5173`입니다.
`dev:web`은 공유 contracts·domain을 빌드한 뒤 Web 개발 서버만 시작합니다.
Mock 모드에서는 로컬 API 서버나 PostgreSQL을 시작할 필요가 없습니다.

API 모드는 `apps/web/.env`의 `VITE_API_MODE=mock|real`로 선택합니다.
개발·테스트의 기본값은 `mock`, 프로덕션 빌드의 기본값은 `real`입니다.
프로덕션 빌드에서는 `mock`을 허용하지 않습니다.
실제 API·DB 연결은 [API 환경 예시](apps/api/.env.example)와
[컨테이너 구성](compose.yaml)을 확인한 뒤 별도 환경에서 준비합니다.

## 검사 명령

```bash
pnpm run format:check
pnpm run lint
pnpm run check:architecture
pnpm run typecheck
pnpm run test
pnpm run build
```

Web 테스트와 production bundle 계약 검사는 따로 실행할 수 있습니다.

```bash
pnpm --filter @nihongo/web run test
pnpm --filter @nihongo/web run test:phase10:bundle
```

일반 Web 테스트는 Vitest, bundle 계약 검사는 별도 Node 테스트 경로를 사용합니다.

## 상세 문서

- [개발 역할·작업 인계](team/README.md)
- [브랜치·커밋·PR·main 통합 규칙](team/git-workflow.md)
- [복구 절차와 운영 준비 조건](operations/runbooks/recovery.v1.md)
