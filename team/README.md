# JLPT 개발·검수 운영

상시 브랜치는 `main`과 `dev` 두 개입니다. 일반 작업은 최신 `dev`에서 시작하고 작업 PR을 `dev`에 squash merge합니다. 릴리스는 `dev` → `main` PR을 merge commit으로 수용해 변경 이력을 보존합니다. `main`에 hotfix 등 별도 실제 변경이 생긴 경우에만 `dev`로 merge 동기화합니다.

정본 [브랜치·검수·버전 운영 절차](git-workflow.md)에 한 페이지 요약, 흐름도, 작업·PR·긴급 수정·버전·정리 절차와 예시가 있습니다.

| 역할        | 책임                                                       |
| ----------- | ---------------------------------------------------------- |
| 팀장(god)   | 범위·담당·의존·검토·통합 판단, 작업별 단일 Git 실행자 지정 |
| FE          | apps/web, API 소비·MSW·UI와 관련 검사                      |
| BE          | apps/api·domain·DB, FE와 합의한 contracts                  |
| DevOps      | 배정된 CI·운영·환경·root 공통 설정                         |
| 기획·디자인 | 요구·콘텐츠와 UI 명세·실제 화면 검수                       |
| 독립 QA     | 작성자와 분리된 검토·관련 검증과 미확인 사항 기록          |

1. 팀장이 JLP ID와 파일 소유권을 배정하고, 최신 `dev` 기준의 단기 `feature/<role>-jlp-ID-topic` 또는 `fix/...`를 준비합니다. 공유 계약과 여러 영역의 변경도 한 task·PR에서 담당을 합의합니다.
2. 지정 worktree의 [Current writer](writer-state.md)를 취득합니다. source writer와 공통 Git 실행자를 구분하고 원본 dirty checkout과 다른 담당의 작업을 보존합니다.
3. 작은 checkpoint와 Draft PR을 허용합니다. QA와 팀장은 PR 생성·갱신 즉시 검토를 시작하며, 병합은 관련 검수와 현재 required CI 성공 후 실행합니다. 완료 PR을 적체시키지 않습니다.
4. 같은 계정 AI팀 PR은 독립 QA·팀장 검토를 받고 native 자기 PR 승인을 요구하지 않습니다. 외부 계정 PR은 작성자와 다른 write/admin 권한 계정의 실제 승인 1건이 추가로 필요합니다. 이 운영 정책과 실제 GitHub enforcement를 구분합니다.
5. 긴급 수정은 최신 `main`에서 시작해 `main` PR로 수용하고 즉시 `dev`로 merge 동기화합니다. 포함된 전체 변경으로 root package의 단일 SemVer를 판단합니다. 실제 배포 tag는 배포할 `main` 커밋에 연결하며, main 병합은 배포와 별개입니다.
6. 완료 시 실제 커밋·PR·검사·실패·미실행과 다음 담당을 Munder에 인계하고 writer를 반납합니다. 브랜치 정리는 미병합·dirty·사용 중 worktree·의존을 확인한 뒤 지정 Git 실행자가 수행합니다.

Munder가 현재 task·담당·다음 행동·근거의 원장입니다. Notion은 기존 god 담당의 단방향 mirror이며 이 작업에서 연동을 변경하지 않습니다. 이번 브랜치 생성·보호·정리의 실제 완료 여부는 root의 실행·원격 확인 기록을 따릅니다.
