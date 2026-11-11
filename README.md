# 하루마루

[한국어](README.md) · [日本語](README.ja.md)

**하루마루**는 JLPT N5~N1을 준비하는 한국어 사용자를 위한 웹 학습 서비스입니다.
가볍게 들어와 몇 문제 풀고, 틀린 문제는 오답노트로 다시 보는 흐름에 집중했습니다.
문제와 해설은 모두 직접 만들었고, 실제 JLPT 기출이나 시판 교재 문항은 쓰지 않습니다.

- 서비스 주소: https://harumaru.app (2026년 11월 공개 예정)

## 주요 기능

| 영역                  | 내용                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 문제 풀이             | 급수(N5~N1)와 과목(문자·어휘, 문법, 독해)을 골라 5·10·20문제를 풉니다. 제출하면 빨간펜으로 채점하는 연출과 해설이 나옵니다. |
| 비회원 체험           | 로그인 없이 하루 3번, 5문제씩 풀 수 있습니다. 로그인하면 마지막 결과를 계정으로 옮깁니다.                                   |
| 오답노트              | 틀린 문제가 자동으로 모이고, 다시 풀어 맞히면 '복습한 문제'로 옮겨집니다. 문제별 메모를 남길 수 있습니다.                   |
| 책갈피·오늘의 한 문제 | 다시 볼 문제를 저장하고, 첫 화면에서 하루 한 문제를 바로 풀 수 있습니다.                                                    |
| 관리자                | 문제 작성 → 검수 요청 → 승인 → 공개 단계, JSON 일괄 가져오기, 문제 신고 처리, 회원 관리를 제공합니다.                       |
| 화면                  | 한국어·일본어 UI, 휴대폰·PC 대응, 키보드 조작과 화면 읽기 프로그램을 고려했습니다.                                          |

로그인은 Google 계정만 지원합니다. 서비스는 비밀번호를 저장하지 않습니다.

## 기술 스택

| 구분      | 사용 기술                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| Web       | React 19, TypeScript, Vite, React Router, TanStack Query, Zustand, Tailwind CSS 4, React Hook Form, Zod, MSW |
| API       | Node.js 22, Hono, Prisma 7, PostgreSQL 18, Better Auth(Google OAuth)                                         |
| 공유 코드 | `packages/contracts`(요청·응답 계약, Zod), `packages/domain`(도메인 규칙)                                    |
| 테스트    | Vitest, Playwright(실제 브라우저·접근성 검사), API·DB 통합 테스트                                            |
| 인프라    | AWS(CloudFront·WAF, EC2, S3, ECR, SSM, CloudWatch, Budgets), Terraform, Docker Compose, Caddy                |
| CI/CD     | GitHub Actions, GitHub OIDC(고정 액세스 키 없음), gitleaks 비밀값 검사, Dependabot                           |

## 구조

```text
사용자 ─ HTTPS ─▶ CloudFront + WAF ─▶ EC2 (Docker Compose)
                                       ├─ Caddy (CloudFront 전용 헤더 확인)
                                       ├─ API (Hono) ── 화면 정적 파일도 제공
                                       └─ PostgreSQL 18 ──▶ S3 백업

GitHub Actions ─▶ ECR (이미지) ─▶ SSM Run Command로 배포
비밀값: SSM Parameter Store / 경보: CloudWatch·Budgets
```

- 서버 상태는 API(개발·테스트에서는 MSW)에서 오고, 화면에서는 `API 함수 → Query Factory → 도메인 훅 → 컴포넌트` 순서로만 다룹니다.
- 인증과 권한은 서버가 판단합니다. 화면 상태(Zustand)에는 로그인 사용자 최소 정보만 둡니다.
- 브라우저 코드가 서버 전용 코드(Prisma, 저장소, 비밀값)를 가져오지 못하게 아키텍처 검사로 막습니다.

## 보안

- 모든 학습 데이터 조회·수정은 DB에서 요청한 사용자 것만 고릅니다.
- 관리자 기능은 요청마다 DB에서 권한을 확인하고, 관리 작업은 30분 안에 다시 로그인해야 합니다.
- 쓰기 요청은 같은 출처만 받고, 쿠키는 `HttpOnly`·`Secure`·`SameSite=Lax`입니다.
- 기능별 요청 제한, WAF 규칙, CloudFront만 접근할 수 있는 서버 포트를 둡니다.
- 비밀값은 저장소에 두지 않습니다. PR은 gitleaks 비밀값 검사를 통과해야 병합할 수 있습니다.

## 저장소 구조

```text
.
├── apps/
│   ├── web/          # 학습자 화면 (Vite·React)
│   ├── admin/        # 관리자 화면 (Vite·React, /admin)
│   └── api/          # API, 인증, 학습·문제 도메인, DB 마이그레이션
├── packages/
│   ├── browser/      # 학습자·관리자 화면 공용 UI
│   ├── contracts/    # 공유 요청·응답 계약
│   └── domain/       # 도메인 규칙
├── content/          # 문제 가져오기 파일, 태그, 품질 규칙
├── infra/            # Terraform(AWS), 로컬 PostgreSQL 초기화
├── operations/       # 운영 절차(배포, 복구, 관리자, 문제 공개)
├── scripts/          # 아키텍처·보안·운영 검사
└── .github/          # CI·배포 워크플로
```

## 로컬 실행 (Mock)

Node.js **22.23.0**, pnpm **10.2.1**을 사용합니다. 저장소 루트에서 실행합니다.

```bash
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
pnpm run dev:web
```

`http://localhost:5173`에서 열립니다. Mock 모드는 API 서버나 DB 없이 MSW로 동작합니다.
`VITE_API_MODE=mock|real`로 고르며, 개발·테스트 기본값은 `mock`이고 프로덕션 빌드는 `real`만 허용합니다.

실제 API와 PostgreSQL을 로컬에서 띄우는 방법은 [로컬 실제 API·DB 실행](operations/runbooks/local-database.v1.md)을 봅니다.

## 검사 명령

```bash
pnpm run format:check
pnpm run lint
pnpm run check:architecture
pnpm run typecheck
pnpm run test
pnpm run build
```

## 운영 문서

- [배포](operations/runbooks/deploy.v1.md)
- [백업 되살리기](operations/runbooks/recovery.v1.md)
- [첫 관리자 지정](operations/runbooks/first-admin.v1.md)
- [문제 가져오기·공개](operations/runbooks/question-import.v1.md)
- [AWS 구성](infra/aws/README.md) · [월 비용](infra/aws/COST.md)
