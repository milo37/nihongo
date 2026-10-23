# main·영역 통합·작업 PR·버전 운영

2026-10-12 사용자 승인 revision2 정본의 SHA-256은 279b0cffc515d6baff6da3320633f4e78508896b8161d015c53331d8f7dbf6cf입니다. God는 통합 책임자입니다. JLP-496 전환의 Git 실행자는 DevOps 한 명이며 다른 직원은 원본 checkout에서 Git 쓰기를 하지 않습니다. 이후 owner의 Git 쓰기는 god가 실제 cwd/branch/파일 범위를 배정한 턴에만 허용됩니다.

브랜치 이름은 2026-10-23 사용자 승인에 따라 선두 접두사를 제거한 표기를 사용합니다. 기존 PR #1~12는 닫힌 이력으로 보존하고 같은 순서의 Draft PR #13~24로 이어집니다. 현재 통합 후보는 `integration/jlp-496-phase10-local`의 [PR #24](https://github.com/milo37/nihongo/pull/24)입니다. 원본 commit과 기존 검수·릴리스 정책은 그대로입니다.

PR 생성·갱신 즉시 기존 QA와 팀장은 changed delta 검토를 시작합니다. Draft 여부와 CI 상태는 코드 리뷰 시작을 막지 않으며, 수정 head도 우선 재검토합니다. CI와 merge gate는 별도로 유지하고 미검증 강제 승인이나 보호 완화는 허용하지 않습니다.

PR 제목과 본문은 한국어로 작성합니다. PR 제목은 `[영역] 무엇을 변경했는지`로 실제 base→head 전체 변경을 대표하고, 본문은 `- 변경:`, `- 검증:`, `- 남은 문제:` 세 줄로 작성합니다. 실제 검사 결과·필요한 링크와 migration·stack 의존·미검증을 남기며 작업일지·대화 경과는 생략합니다.

## 브랜치와 수용 대상

| branch/변경                                         | base·수명                       | PR target / owner·검수                                                    |
| --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| main                                                | 영구 최종 기준                  | 검수된 release/hotfix PR만; god 책임 G3→G4                                |
| frontend                                            | 승인 main M, FE 통합 유지       | FE task·공통 PR 수용; 승인 F→release / FE·BE·QA·해당 디자인·god           |
| backend                                             | FE와 같은 M, BE 통합 유지       | BE task·공통 PR 수용; 승인 B→release / BE·FE·QA·god·해당 디자인           |
| feature/jlp-ID-fe-topic 또는 fix/jlp-ID-fe-topic    | 고정 FE head, task 종료까지     | frontend / FE writer; G1 후 수용, G2 actual head                          |
| feature/jlp-ID-be-topic 또는 fix/jlp-ID-be-topic    | 고정 BE head, task 종료까지     | backend / BE writer; G1/G2                                                |
| 공통 contracts task                                 | main M+승인 의존, 양쪽 소비까지 | 동결된 같은 source head로 FE/BE 각각 PR / BE 단일 writer·양쪽 합의·QA·god |
| CI/Docker/운영·root runtime/deps/lockfile 공통 task | main M+의존, 양쪽 소비까지      | 양쪽 영역 PR / named DevOps·FE/BE 영향 검수; provisioning은 BE 합의       |
| BE 전용 provisioning/DB task                        | BE 승인 head                    | backend / DevOps provisioning, BE schema/migration; 범위 분리             |
| 제품 version/CHANGELOG/release-record task          | 통합 후보 R, 해당 배치까지      | release 후보 / god 지정 DevOps release owner·FE/BE/QA                     |
| 콘텐츠 데이터·seed·게시 계약                        | BE 승인 head                    | backend / BE repository writer·named 콘텐츠/기획 검수·FE·QA               |
| UI 콘텐츠·번역                                      | FE 승인 head                    | frontend / FE writer·기획·디자인·BE·QA                                    |
| release/<target-semver>                             | 최신 승인 M, 한 배치            | main / named integration writer·양쪽 owner·QA·디자인·god                  |
| fix/jlp-ID-role-hotfix-topic                        | 현재 main, 긴급 수정 종료까지   | main, 이후 FE/BE/열린 후보 sync / 영향 owner·전체 gate                    |
| legacy phase11/PR1                                  | 이관 판정까지 보존              | 기존 상태 유지; 전체 main 반영·force·삭제 금지                            |

task ref에는 fe/be/devops 등 실제 role과 topic을 넣어 같은 JLP의 FE/BE 이름 충돌을 막습니다. <target-semver>는 목표 버전 자리표시자이며 다음 버전이 확정됐다는 뜻이 아닙니다. 영구 develop이나 구버전 maintenance line은 만들지 않습니다. 사용/미병합/소유 불명·의존 중 branch는 삭제하지 않습니다. 적격 삭제는 god가 소유/병합/검수/비사용/의존 종료를 확인한 task 범위만이며 현재 JLP-496 조사에서는0입니다.

## worktree·writer·checkpoint

- actual remote main SHA, PR/CI/protection과 기존 worktrees를 조회한 뒤 중복 없는 격리 cwd를 준비합니다. refs/config/공통 metadata는 단일 실행자, 각 worktree에는 writer1명입니다.
- 원본 dirty checkout의 source/index/branch/history/5173은 그대로입니다. 원 writer 파일도 보존 대상이면 Munder/evidence lease를 먼저 기록하고 격리 worktree에 acquired→released를 기록합니다.
- .env/DB/port/node_modules/build outputs를 다른 작업으로 복사하거나 임의 공유하지 않습니다. 포맷 도구를 기존 설치에서 읽기 실행하는 것과 종속 파일을 worktree에 복사하는 것은 구분합니다.
- God가 owner/files/hunks/의존/검수·미실행을 분류한 뒤 지정 파일만 stage합니다. cached diff와 비밀/무관 변경을 확인하고 실제 JLP ID로 commit합니다. git add . / add -A, stash/reset/clean/force, 원본 switch는 금지합니다.
- owner의 normal non-force task push와 Draft PR은 WIP 저장입니다. 최종 QA/UI/real API/all CI/보호 확인 완료가 선행 조건은 아니며 실패·미실행을 남깁니다. 작성자는 merge하지 않습니다.
- 실제 cwd/branch/base/head/commit/PR/check-target와 writer 반납을 god에게 인계합니다. hive 자동 commit은 제품 Git commit이 아닙니다.

## 공통 변경과 merge 방식

C0를 main M에서 단일 owner가 한 번 작성하고 source SHA·정규 변경 ID·content hash·patch-id·파일/hunk·의존·migration checksum을 동결합니다. contracts는 FE/BE 합의 뒤 BE가 작성합니다. 첫 수용 후 source를 바꾸지 않고 후속 task로 수정합니다.

- 실제 보호에 linear history가 없고 merge commit이 허용되면 단일 영역 task는 squash 가능, 공통 C0·영역→후보→main·main sync는 merge commit을 사용합니다. 두 영역에 같은 C0 ancestry가 있고 후보에서 정규 ID는 한 번만 계수합니다.
- 어느 관련 branch든 linear history가 필수면 전체 배치를 linear 방식으로 고정합니다. PR squash를 기본으로 허용된 task rebase-merge만 사용합니다. 정규 ID/source/content SHA→FE·BE·후보 actual 수용 SHA 매핑으로 동등성을 확인하며 같은 ancestry를 유지했다고 주장하지 않습니다.
- linear/오염 후보는 최신 M에서 새 비공유 branch로 승인 전체 단위를 재현합니다. 공통1회→FE 고유→BE 고유를 수용하고 전면 G2를 다시 받습니다. 공유 branch force-rebase나 두 common 복제 SHA의 이중 반영은 하지 않습니다. patch-id만으로 동등성을 판정하지 않습니다.
- 보호 상세/허용 방식 미확인·서명/기타 조건 충돌이면 해당 적용을 HOLD합니다. 보호를 낮추거나 credential을 바꿔 우회하지 않습니다. 실제 수정은 해당 파일 owner가 맡습니다.

## admission freeze와 동기화

1. 기본은 배치별 수용 허용 목록 동결입니다. M/배치 ID/merge 방식/task source SHA·PR·정규 ID·전체 hunk·의존 closure·순서를 god가 고정합니다. exact-head G1 완료 단위만 영역에 넣고 미승인 task는 feature/fix에 남깁니다.
2. 영역 actual SHA를 기록하고 G2에서 M→F/B 전체 diff/추가 ancestry/의존·공통 중복을 검사합니다. merge 방식에서 통과한 고정 F/B만 후보에 merge합니다. 동결 후 새 영역 작업은 다음 배치입니다.
3. 오염 영역/linear 방식은 원본을 보존하고 M에서 승인 task-SHA 전체 단위+필수 의존만 재구성합니다. 옛 F/B merge와 선택 hunk 재구성을 혼합하지 않습니다. 바뀐 범위는 새 G1, 재구성 head는 god·양쪽 owner·독립 QA·해당 디자인의 전면 G2 대상입니다.
4. M/허용목록 hash/F·B 또는 재구성 SHA/actual R·tree/common map/review·CI tuple을 동결합니다. 미승인 ancestry/diff·누락·중복·checksum 불일치·미검수 충돌이 있으면 G3로 가지 않습니다.
5. main M′ 또는 후보 수정은 새 sync PR·head·CI·QA/UI·새 rc로 검수합니다. merge 방식은 일반 merge, linear는 새 branch 재현과 SHA map으로 수용합니다. 공유 reset/force는 금지합니다.
6. actual main C의 G4 뒤 FE/BE와 열린 후보로 sync해 실제 수용 SHA를 인계합니다. 같은 파일 내용만으로 옛 head 승인을 자동 재사용하지 않습니다.

## G1–G4와 실제 CI 결속

검수 tuple은 H(task/PR head), T(최신 target base), E(GitHub가 평가한 head/merge-ref), S(actual checkout), merge tree, run ID/attempt, 검수 manifest hash입니다. H/T/E/S/범위가 바뀌면 이전 승인·CI는 무효입니다.

**최신 사용자 결정 — 2026-10-24, G3 및 reviewer 정책 override:** 작성자와 독립 QA는 서로 다른 담당 AI이면 충분합니다. 같은 `milo37` GitHub 계정 사용이나 별도 reviewer 계정 부재 자체는 main 보류 사유가 아닙니다. 독립 QA·팀장 최종 승인·current-head required CI 성공과 해당 디자인 등 기존 검수 조건은 유지합니다. 아래 G3의 “별도 적법한 native 승인” 및 뒤의 별도 reviewer identity/HOLD 문구는 역사적 원문으로 보존하며, 해당 계정 분리 요구에는 이 결정이 우선합니다. GitHub native 자기 PR `APPROVE`가 성공했다고 주장하지 않으며, 별도 계정 생성이나 보호 설정 변경도 하지 않습니다.

| gate                            | 필수 조건                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 task→영역/후보               | exact H/T/E/S god 승인·독립 QA·해당 UI 디자인, owner scope·관련 unit/lint/type/build·계약/DB 영향·필수 CI actual success                                                        |
| G2 actual 영역/공통/재구성 head | exact head/M god·독립 QA·해당 디자인, 전체 diff/ancestry/closure/common map·양쪽 build·migration/호환·real 권한/소비·CI actual success; 재구성은 전면 검수                      |
| G3 후보→main PR                 | 승인 목록/M/F/B 또는 재구성/R/E/S, real API·인증·학습 저장/재개·제출/복습·DB migration·회귀·KO/JA/PC/mobile·보안/운영, god·QA·디자인·별도 적법한 native 승인·최신 merge tree/CI |
| G4 actual main C                | C의 CI/build/manifest·버전/artifact/DB 호환, tree 변화 영향 재검수 또는 god/QA의 C 재사용 범위 확인; 완결 전 final tag/Release 금지                                             |

기존 필수 main contexts는 Quality and production build, Phase 10 real/mock browser and regression acceptance, Phase 11 portable release and production-mode smoke입니다. 단일 JLPT required gate와 admission_binding은 승인 전략의 **향후 named CI 구현 범위**이며 이 문서9 commit에 구현하지 않습니다. 기존 검사를 제거/약화하지 않습니다.

향후 aggregator는 if: always(), needs: [build, e2e, phase11_release, admission_binding]로 실행하고 모든 필수 producer/matrix/step가 actual success인지 검사해야 합니다. binding은 같은 run/attempt의 실제 E/S/tree/artifact source/허용 목록·버전/common map을 검증한 뒤에만 true를 냅니다. boolean 입력이나 continue-on-error/skip를 성공으로 포장하지 않습니다. gate 자체 completed/success도 병합 직전에 확인하며 skipped/neutral/cancelled/failure/pending/누락은 HOLD입니다. path/branch filter로 필수 workflow를 생략하지 않고 새 branch push/PR·필요 시 merge_group 지원을 실제 구현·시험·등록해야 합니다. workflow_dispatch를 PR 필수 check의 대체로 추정하지 않습니다.

## 실제 원격 관찰과 남은 서버 gate

JLP-496 실제 gh GET/ls-remote 관찰: 원격 main a0c6dd47d44193ed4f09d2c2581f7a536aabfc31, phase11 d9c01fec34b2b25fc9a020e0b9a2bfd40f2b831f, 기존 PR1 Draft/unmerged, 원격 tag0. main exact SHA의 과거 run31585409571은 success(2026-08-12), phase11 해당 head의 PR/push runs는 failure입니다. 과거 CI를 fresh product/DB/Phase11 PASS로 표시하지 않습니다.

기존 gh 인증으로 main 보호 GET는 성공했습니다. strict checks3·enforce_admins true·force/deletion false·linear false·native approval count0입니다. repo merge/squash/rebase 허용, rulesets0입니다. 앞선 connector403과 이번 CLI 읽기 권한은 구분합니다. credentials/보호 설정은 바꾸지 않았습니다.

현재 main source workflow는 Quality job 하나이며 Phase10/11, 새 area push, required aggregator/binding은 없습니다. 누락 필수 context를 임의 제거하지 않고 named foundation/CI task에서 보완해야 합니다. 새 영역이 자동으로 main 보호를 상속한다고 주장하지 않습니다. 영역 보호가 설정되지 않았으면 운영 규칙과 서버 enforcement를 구분하고 완료로 표시하지 않습니다.

같은 milo37 계정의 god/QA 역할은 native 독립 reviewer/merge 권한 분리가 아닙니다. 정책상 적법한 별도 reviewer identity가 없으면 main gate는 HOLD이며 실제 required count0이 이를 면제하지 않습니다. reviewer identity/actual CI/영역 보호/immutable Release 확인은 남은 gate입니다. 새 계정·plan·권한 확대나 보호 완화는 임의 수행하지 않습니다.

## 제품 버전·공개 계약·Release

root package.json.version을 제품 SemVer 단일 원본으로 관리하고 현재 private package mirror는 release owner가 파생 갱신합니다. /api/v1, contract version/hash, manifest schemaVersion, DB migration 번호는 독립 식별자입니다. 이 bootstrap은 버전/CHANGELOG/manifest를 생성·변경하지 않습니다.

공개 계약 표면은 사용자 보장 로그인·학습 저장/복원·제출/복습/책갈피·route·저장 데이터 의미, /api/v1 요청/응답/오류/권한, contracts DTO/Zod/enum/export, 문서로 약속한 upgrade/DB↔artifact 지원 범위입니다. FE/BE가 영향과 version/hash·지원 목록을 합의하고 QA·기획/디자인·DevOps 호환 근거로 god가 bump를 확정합니다. 내부 SQL 변경만으로 무조건 MAJOR라 하지 않지만 공개 데이터/지원 보장을 깨면 breaking입니다. 실제 공개 계약 원본·호환 profile은 선행 named task에서 동결합니다.

| 효과                            | 증가                                       |
| ------------------------------- | ------------------------------------------ |
| 0.x 호환 오류 수정              | PATCH                                      |
| 0.x 기능/deprecation/breaking   | MINOR, 전환 안내                           |
| 1.x 호환 오류 수정              | PATCH                                      |
| 1.x 호환 기능/deprecation       | MINOR                                      |
| 1.x 공개 계약/지원 범위 파괴    | MAJOR                                      |
| 후보 수정                       | 같은 목표의 다음 rc, 새 SHA/build/검수     |
| 공개 계약/산출물 영향 없는 기록 | task별 bump 없음; 발표 버전 내용 변경 금지 |

0.x 증가와 1.0 진입은 프로젝트 로컬 정책입니다. 1.0은 공개 안정 계약/핵심 흐름/콘텐츠/real 연동/독립 검수·현재 CI를 충족한 뒤 사용자에게 제안하며 production 허가는 별개입니다. deprecation은 대체·전환 기간·종료 대상과 호환 릴리스에서 알립니다. 발표 기능을 없애는 breaking revert는 1.x MAJOR/0.x MINOR이며 자동 PATCH가 아닙니다. 발표 전 되돌림은 새 rc입니다.

RC/final 모두 published immutable GitHub Release로 보존하는 정책입니다. v는 tag 관례이며 productVersion에는 없습니다. 단순 tag/pre-release flag만으로 불변 보호를 얻지 않습니다. 실제 활성화 확인→source/build/검수 동결→Draft→전체 검증 assets/manifest/동반 기록→publish→tag SHA/asset digest/Immutable readback 순서이며 미확인 시 HOLD입니다. RC는 G3, final은 actual C의 G4가 선행합니다. title/notes/flag가 편집 가능해도 정규 CHANGELOG/release-record hash를 asset에 결속해 원문을 보존합니다. tag/asset 덮어쓰기·이동·삭제·재사용/floating tag는 하지 않습니다.

기존 manifest v1의 releaseId40자리 SHA와 strict exact keys는 유지하고 SemVer는 별도 versioned release-record로 연결합니다. productVersion/tag→source SHA/tree·E/S→run/attempt/buildId→OCI digest/API·Web inventory→manifest/lock/runtime→공개/transport/contracts version/hash→ordered migration/checksum·DB profile·호환 artifact→environment ID·secret 없는 config hash→검수 근거/시각을 결속합니다. source SQL 개수만으로 설치 ledger/호환을 증명하지 않습니다. 환경 rebuild는 새 digest/build이며 같은 artifact 승격으로 표시하지 않습니다.

가정 예시: 목표0.2.0 후보 R1에서0.2.0-rc.1 build/G3→immutable RC, 수정은rc.2입니다. 정식값으로 바꾼 R2는 새 SHA/build/G3, main merge actual C는 G4/build 후 v0.2.0 final에 결속합니다. 다음 버전0.2.0은 확정되지 않았으며 실제 tag/Release/배포는0입니다.

## hotfix·rollback·기존 작업 이관

지원선은 main 하나, 최신 검증 final입니다. 임시 release 후보는 구버전 유지 line이 아닙니다. main==stable S인 최소 오류 수정은 PATCH로 G1/G3→actual H G4→final 후 H를 양쪽 영역/열린 후보에 sync합니다. 미래 후보 version은 다운그레이드하지 않습니다.

main이 stable보다 앞서면 current M′에서 fix를 작성하고 S→M′ 전체 승인 변경+fix를 전면 G3/G4로 검수하며 전체 효과로 version을 정합니다. 예컨대 기능이 포함돼 있으면 fix만 이유로 구버전 PATCH를 내지 않습니다. 불가 시 hotfix 발표도 HOLD이며 구버전 line/backport는 별도 사용자 정책 변경 없이 만들지 않습니다.

코드 rollback은 exact DB 호환이 확인된 불변 artifact 또는 검수 revert PR입니다. DB rollback은 자동 down migration/restore가 아니며 BE가 ledger/schema/변경 데이터/호환을 판단합니다. 불호환이면 roll-forward가 우선, 데이터 손실/backup restore는 정확한 대상·복구 검수·사용자 허가가 별도입니다. DB/볼륨 reset, tag/version 되감기는 금지합니다.

원본110 이력/dirty303/private 보존본/PR1은 그대로 둡니다. historical49 task-ID/61미상/42mixed와 freeze58/owner미확인245는 후속 단위 선정 때 재확인합니다. main의 없는 API/domain/DB/tooling을 이미 있다고 가정하지 않고 작은 named foundation/dependency task로 이관합니다. 공통 C0 먼저→고유 BE/FE task→admission 후보로 진행하며 FE488/491 중첩은 최종491을 한 번만 소비합니다. 소유 불명/분리 불가 hunk만 HOLD하고 안전한 개별 WIP 저장을 전체 backlog 완료까지 막지 않습니다. actual head/CI/검수·역동기화·원본 불변을 확인한 뒤 이관 완료로 판정합니다.
