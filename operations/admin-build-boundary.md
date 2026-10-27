# 관리자 분리 후보의 빌드 경계

JLP-531 로컬 후보는 JLP-519의 `apps/admin`과 `packages/browser`를 동결본 그대로 재사용합니다. 공통 패키지는 파일별 명시적 export만 제공합니다. Node 22.23.0 / pnpm 10.2.1과 현재 dev의 의존성 버전·보안 override를 유지합니다.

## 현재 인계 상태

DevOps는 새 두 workspace, Vite/Tailwind 설정, 소스·산출물 경계 검사, 최소 CI gate와 Docker 소비선을 연결했습니다. 현재 dev의 `apps/web/src`와 `apps/api/src`는 보존했습니다. **앱 분리 통합과 production 관리자 제공이 완료된 후보가 아닙니다.**

FE는 현재 web의 SSO·요청 취소·canonical 관리자 동작을 유지하며 공통 export 소비, 문서 이동 방식의 앱 간 navigation과 web 관리자 import 제거를 인계받습니다. BE는 기존 `createApp.ts`, `staticWeb.ts`, `server.ts` 및 관련 테스트에서 관리자 HTML·asset에 `adminReadGuard`, `private, no-store`, `Vary`를 연결합니다. 원본 donor의 production 비활성화/404 조건은 별도 정책 경계이며 Docker 패키징으로 활성화되지 않습니다.

## 기존 명령과 산출물

- `pnpm run test:admin-build-boundary`, `pnpm run check:architecture`, 각 workspace `typecheck`와 관련 `test`를 사용합니다. `pnpm run build:browser`는 web/admin의 공식 build를 순서대로 실행하며 미완료 web import 경계를 숨기지 않습니다.
- admin dev/preview는 5175/4175이고 real API mode만 허용합니다. 이번 작업은 서버·DB·브라우저를 실행하지 않습니다.
- 배포용 web/admin은 같은 전체 Git SHA의 `VITE_RELEASE_ID`, `VITE_API_MODE=real`, `VITE_API_BASE_URL=/api`, `NIHONGO_RELEASE_BUILD=1`을 요구합니다. 소스/산출물 검사는 Node·서버/domain·생성 content·실키·mock worker 및 web의 관리자 모듈을 거부합니다.
- Docker 소비선은 독립 `/app/api`, `/app/web`, `/app/admin`과 `release-manifest.json`을 구성합니다. 실제 Docker build·배포는 이 인계에 포함하지 않습니다.
- 기존 release CLI의 생성/검증/OCI mode, clean exact-source 및 atomic-output 검사를 유지합니다. `--admin-directory` 생략 시 schemaVersion 1 API/Web, 지정 시 schemaVersion 2 API/Web/admin으로 생성하는 10/23 호환 수정본을 재사용합니다. 두 브라우저의 release marker와 artifact graph를 검사하며 기존 strict verifier를 완화하지 않습니다.

구체적인 현재 SHA·파일 비교·보존·실행 결과는 DevOps evidence `jlp-531-jlp519-local-reintegration-20261025`에서 관리합니다. 이 문서는 원격 push/PR·병합·실DB·외부 서비스 활성화 권한을 추가하지 않습니다.

## 로컬 공개 origin

기존 `pnpm dev`는 web/API와 admin을 함께 실행하고 `pnpm preview`는 web/admin preview를 함께 실행합니다. 개발 공개 진입은 `http://localhost:5173`, preview는 `http://localhost:4173`입니다. 해당 origin의 정확한 `/admin` 하위만 admin5175/4175로 전달하고 `/login`은 web에서 제공합니다. bare `/admin`은 upstream의 `/admin/` base에 맞추며 query는 보존합니다. admin upstream 포트 점유 시 자동 증분 대신 실패합니다.

기본 web Mock 동작은 유지합니다. 실제 API를 사용하는 로컬 두 앱 여정은 기존 환경 설정으로 `VITE_API_MODE=real pnpm dev`를 사용하며 기존 API origin·쿠키·SSO redirect 허용 범위는 유지합니다. 이 명령 실행은 DB/실계정/외부 서비스 활성화 승인을 추가하지 않습니다.
