# JLPT 개발·검수 운영

사용자가 승인한 revision2는 main·FE/BE 영역·작업 PR·최종 통합 후보 순서입니다. God가 범위와 통합 책임을 맡고 Munder가 작업 원장입니다.

| 역할    | 책임                                                                  |
| ------- | --------------------------------------------------------------------- |
| god     | task/base/dependency/cwd/owner/file 범위, 검수·PR·main 통합 판단      |
| FE      | apps/web, API 소비/MSW/UI 검사                                        |
| BE      | apps/api·packages/domain·DB schema/migration, FE 합의 후 contracts    |
| DevOps  | 지정 CI/Docker/환경/운영, root/version 지정 범위, common Git metadata |
| 기획    | 요구·수용 기준·콘텐츠 검수                                            |
| 디자인  | 구현 전 명세, 구현 후 실제 화면                                       |
| QA·리뷰 | 정확한 대상의 독립 검증, 소스/index/refs 편집 금지                    |

1. God가 branch/cwd/base와 파일 소유권을 배정합니다. [브랜치·버전 규칙](git-workflow.md)에서 PR target과 의존을 확인합니다.
2. 지정 worktree의 [Current writer](writer-state.md)를 취득합니다. 원본 dirty checkout에는 이번 전환의 writer 기록도 쓰지 않습니다. 같은 Git metadata는 단독 실행자만 변경합니다.
3. owner는 자기 범위만 구현·검사·scoped commit·normal push·Draft PR합니다. 담당이 배정됐다는 사실만으로 다른 영역/공통 파일 소유권을 얻지 않습니다.
4. task→영역 G1, 고정 영역/공통·재구성 후보 G2, release→main G3, actual main G4에서 god·독립 QA·해당 UI 디자인·정확한 SHA CI를 확인합니다. checkpoint 저장은 먼저 가능하며 main 병합 가능과 구분합니다.
5. 실제 SHA/PR/검수·실패·미실행·다음 담당을 Munder에 인계하고 writer를 반납합니다. 같은 계정의 역할 검토를 native 별도 APPROVE라 하지 않습니다.

기존 원본303·index·phase11/PR1·5173과 기존 DB/볼륨/.env는 보존합니다. 취소된 JLP-487과 보관 JLP-1–8은 재개하지 않습니다. 기존110 이력은 작은 승인 task/dependency 단위로만 옮깁니다.

문서9 첫 PR은 actual main a0c6dd47에서 출발한 공통 정책 변경입니다. 이 baseline의 오래된 CI 성공이 현재 real API/DB·Phase11 PASS를 의미하지 않습니다. 정책 채택, branch 생성, commit/push/Draft PR, 영역 병합, main 병합, Release/서비스 배포는 별도 상태로 기록합니다.

Notion은 기존 god 예약이 Munder를 반영합니다. 역할 TOML은 재사용 지침이며 항상 실행 중인 채팅·native 로딩·office QA 복구를 증명하지 않습니다. 새 직원/temps/nested workers 없이 기존 역할과 동시 기여자 한도를 유지합니다.
