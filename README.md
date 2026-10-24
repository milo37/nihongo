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

Node.js **22.23.0**, pnpm **10.2.1**을 사용합니다. 아래 명령은 모두 저장소 루트에서 실행합니다.

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

## 실제 API·DB 로컬 실행

루트·API의 `.env.example`과 API의 `.env.test.example`을 각각 `.env`·`.env.test`로 복사합니다.
루트의 `POSTGRES_PASSWORD`·`PHASE7_*_PASSWORD`는 서로 다른 24자 이상 URL-safe 값으로 설정하고 API 연결 URL에 대응시킵니다.
이 로컬 구성은 production provisioning의 대체물이 아닙니다.

**지속형 기술 runtime: 55433, 별도 project·volume**
TEST·DEVELOPMENT의 API 환경에서 `ADMIN_CMS_MODE=technical`과 해당 wrapper 연결 URL을 설정한 뒤 각각 실행합니다.

```bash
docker compose --project-name nihongo-phase7-local --profile phase7-local up -d --wait postgres-phase7
NODE_ENV=test pnpm run db:migrate:phase7
ADMIN_CMS_MODE=technical pnpm run db:seed:test
pnpm run db:migrate:phase7
ADMIN_CMS_MODE=technical pnpm run db:seed:dev
```

activation에는 `phase7_environment=TEST` 또는 `phase7_environment=DEVELOPMENT`를 사용하며 명시적 후속 승인 전에는 실행 금지입니다.
기술 startup은 activation 전에는 의도적으로 실패합니다.
승인된 activation 뒤 TEST는 `DOTENV_CONFIG_PATH=.env.test ADMIN_CMS_MODE=technical pnpm run dev:api`, DEVELOPMENT는 `ADMIN_CMS_MODE=technical pnpm run dev:api`로 시작합니다.

**임시 통합 runner: 55432, 위 runtime과 volume 공유 금지**
API `.env.test`의 `PHASE7_INTEGRATION_DATABASE_URL`·`PHASE7_API_INTEGRATION_DATABASE_URL`은 기본 55432 연결을 유지합니다.

```bash
docker compose up -d --wait postgres
pnpm run test:phase7:db
pnpm run test:phase7:api
```

runner는 wrapper login이 하나라도 이미 존재하면 안전하게 중단합니다.

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
