# 배포 v1 (기본 = 자동)

하루마루 배포의 단일 문서입니다. 평소 배포에는 사람이 명령을 붙여 넣지 않습니다. 사람 손이 필요한 일은 맨 아래 "사람만 하는 일"에만 있습니다. 수동 명령은 부록 A(비상·학습용)에만 둡니다.

## 1. 평소 흐름

| 순서 | 무엇                                                                                                                                                   | 누가       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1    | `dev`를 `main`에 통합(QA GO·CI 통과 뒤)                                                                                                                | 팀장       |
| 2    | **Release image**(`.github/workflows/release-image.yml`, 잡 `Publish runtime and migrate images`)가 ECR에 `<SHA>`·`<SHA>-migrate`를 올림               | 자동       |
| 3    | 같은 워크플로의 잡 **Deploy to STAGING**이 OIDC 역할로 SSM 문서 `harumaru-staging-deploy`(releaseId = 그 SHA)를 실행하고 `Success`를 기다림(최대 25분) | 자동       |
| 4    | 같은 잡이 `<STAGING 주소>/health/ready`가 200인지(응답에 `x-release-id`가 있으면 그 SHA와 같은지) 최대 5분 확인                                        | 자동       |
| 5    | PRODUCTION 배포: GitHub environment `production`의 **승인 버튼**을 누르면 같은 SHA를 배포(4절, 변수·environment를 넣기 전에는 건너뜀)                  | 사람(승인) |

- 결과는 GitHub Actions의 Release image 실행 화면에서 봅니다. 초록이면 STAGING에 그 SHA가 떠 있습니다.
- 저장소가 공개라 로그에는 상태와 `deploy.sh` 결과 줄(`deployed <SHA>`, `refusing: …`, `health check failed …`, `rolled back …`)만 남습니다.
- 한 번에 하나만 배포합니다(concurrency `staging-deploy`). 진행 중인 배포는 끊지 않습니다. 기다리는 배포는 하나만 남아서, 연달아 병합하면 중간 SHA의 배포는 취소되고 STAGING은 가장 새 SHA로 갑니다(의도된 동작).
- 배포 전에 그 SHA가 지금 `main` 끝인지 확인하고, 아니면 배포를 건너뜁니다(옛 실행을 다시 돌려 STAGING이 옛 SHA로 돌아가는 것을 막음).
- 서버 안에서 `deploy.sh`가 하는 일(DB 역할 확인 → 배포 전 백업 → migration → capability → API 교체 → health → 실패 시 직전 release로 롤백)은 [production-database.v1.md](production-database.v1.md) "Deploy order"에 있습니다.

### 실패했을 때

- `Publish` 실패: 이미지가 없으니 서버는 그대로입니다. 팀이 고쳐 다시 main에 올립니다.
- `Deploy to STAGING` 실패: `deploy.sh`가 직전 release로 되돌리거나(롤백), 새 API를 띄우기 전에 멈춥니다. 로그의 결과 줄을 팀(DevOps)이 보고 고칩니다. 다시 배포하려면 Actions에서 **가장 최신 Release image 실행만** **Re-run failed jobs**를 누릅니다(사람 붙여넣기 없음). 옛 실행을 다시 돌리면 배포 단계는 건너뜁니다.
- 같은 SHA를 다시 돌려도(Re-run, 수동 실행) ECR에 이미 있는 태그는 다시 만들거나 올리지 않고 배포로 넘어갑니다(태그는 덮어쓸 수 없음, immutable).
- 데이터를 되살려야 할 때만 [recovery.v1.md](recovery.v1.md)를 씁니다.

## 2. 켜는 조건 (한 번)

`Deploy to STAGING`은 저장소 변수 두 개가 있어야 돕니다. 없으면 건너뛰고 이미지만 만듭니다.

| 변수                  | 값(비밀값 아님)                                   |
| --------------------- | ------------------------------------------------- |
| `STAGING_INSTANCE_ID` | STAGING terraform `output instance_id` (`i-…`)    |
| `STAGING_SITE_URL`    | STAGING terraform `output site_url` (`https://…`) |

이미 있는 변수 `AWS_DEPLOY_ROLE_ARN`·`ECR_REPOSITORY_URL`·`AWS_REGION`(이미지용)은 그대로 씁니다. 배포 역할은 `infra/aws/github.tf`의 `RunDeployOnHost`대로 **그 인스턴스·그 문서에만** `ssm:SendCommand`를 보낼 수 있고, `main`에서만 쓸 수 있습니다. terraform 변경은 없습니다.

## 3. 환경을 처음 채울 때 (한 번, 반복 아님)

빈 DB에 첫 배포가 끝난 뒤 한 번만 합니다. 평소 배포에는 필요 없습니다.

1. 첫 관리자: [first-admin.v1.md](first-admin.v1.md)
2. 태그 18: [question-import.v1.md](question-import.v1.md) 1단계
3. 문제 500 가져오기·검수 요청·승인·공개: 팀이 부록 B 명령 두 번(dry run → confirm). 관리자 화면 클릭·재로그인 없음

## 4. PRODUCTION (승인 버튼, 켜기 전)

- 잡 **Deploy to PRODUCTION**(`release-image.yml`)은 STAGING이 그 SHA로 떠 있을 때만(`deploy-staging` 결과 `deployed=true`) 대기 상태가 되고, GitHub environment `production`의 승인을 기다립니다. 사장님은 Actions 실행 화면(또는 알림)에서 **Review deployments → production → Approve**만 누릅니다. 거절하거나 두면 PRODUCTION은 그대로입니다.
- 승인 뒤 STAGING과 같은 단계(`.github/actions/ssm-deploy`): main 끝 SHA 확인 → PRODUCTION 역할 → 문서 `harumaru-production-deploy`(releaseId = 그 SHA) → `/health/ready` 200. 이미지는 STAGING이 쓴 `<SHA>`·`<SHA>-migrate` 그대로입니다(재빌드 없음, ECR 공유).
- 옛 실행을 승인해도 main 끝이 아니면 배포하지 않습니다. 승인 대기가 여럿이면 concurrency `production-deploy`로 가장 새 것만 남습니다.
- PRODUCTION 역할은 environment `production`의 잡만 믿습니다(`infra/aws` `github_deploy_environment`). 그래서 승인 없이 PRODUCTION에 배포하는 길이 없습니다. Caddy 이미지 빌드(`caddy-image.yml`)도 같은 역할이라 그 잡도 승인을 거칩니다.
- 켜는 순서(바꾸면 안 됨): **① environment `production` 보호 먼저** — 저장소 Settings → Environments에서 만들고 Required reviewers = 사장님 계정, Deployment branches = `main`, "Prevent self-review" 끔(병합 실행자가 사장님 계정이라 켜면 승인할 사람이 없음). **② 그 다음에 저장소 변수** `PRODUCTION_AWS_DEPLOY_ROLE_ARN`·`PRODUCTION_INSTANCE_ID`·`PRODUCTION_SITE_URL`(PRODUCTION terraform output, 비밀 아님). 변수가 없으면 잡은 건너뜁니다.
- 이유: GitHub는 없는 environment를 처음 쓸 때 **보호 규칙 없이** 자동으로 만들고, PRODUCTION 역할은 environment 이름만 봅니다. 변수를 먼저 넣으면 승인 없이 배포될 수 있습니다. 그래서 잡은 시작하자마자 `production`에 필수 검토자가 있는지 API로 확인하고, 없으면 AWS 역할을 받기 전에 실패합니다.
- STAGING을 평소 정지해 두는 경우(`infra/aws` `host_stop_schedule_expression`): 저장소 변수 `STAGING_START_IF_STOPPED = true`면 STAGING 배포 잡이 먼저 서버를 켜고 SSM 에이전트가 붙을 때까지(최대 5분) 기다립니다.

## 사람만 하는 일

반복 작업은 여기 없습니다. 모두 로그인·결제·승인처럼 사람만 할 수 있는 일입니다.

| 언제                     | 일                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 자동 배포 켤 때(1회)     | AWS에 로그인해 STAGING `instance_id`·`site_url` 두 값을 확인해 팀장에게 전달(값은 비밀 아님). 저장소 변수 등록은 팀장이 해도 됩니다. |
| 인프라가 바뀔 때만       | `terraform plan` 확인 후 `apply`(AWS 로그인·MFA)                                                                                     |
| 비밀값이 새로 생길 때만  | SSM SecureString 등록(값은 채팅·파일에 남기지 않음)                                                                                  |
| 환경을 처음 채울 때(1회) | 관리자 Google 계정 로그인 1번(첫 관리자 만들 때). DB 비우기·문제 500 공개(부록 B)는 팀이 실행하고 사장님은 승인만 합니다.            |
| PRODUCTION 전(1회)       | 도메인 구입, AWS 유료 전환, CloudFront 요금제 가입, Google OAuth 주소 등록, 경보 메일 구독 확인                                      |
| PRODUCTION 배포마다      | Actions의 **Approve** 버튼 1번                                                                                                       |

---

## 부록 A. 수동 배포 (비상·학습용)

자동 배포가 고장 났거나, 흐름을 손으로 따라가 보고 싶을 때만 씁니다. 평소에는 쓰지 않습니다.

`aws login`된 터미널, `infra/aws`(해당 환경 state)에서:

```sh
IID=$(terraform output -raw instance_id)
DOC=$(terraform output -raw deploy_document)
REL=<배포할 main 40자 SHA, ECR에 이미지가 있어야 함>
cid=$(aws ssm send-command --instance-ids "$IID" --document-name "$DOC" \
  --parameters "releaseId=$REL" --query Command.CommandId --output text)
aws ssm wait command-executed --command-id "$cid" --instance-id "$IID" || true
aws ssm get-command-invocation --command-id "$cid" --instance-id "$IID" --query Status --output text
curl -s -o /dev/null -w '%{http_code}\n' "$(terraform output -raw site_url)/health/ready"
```

- 기대: `Success`, 그리고 `200`. `aws ssm wait`는 약 100초에서 끝나므로 `InProgress`가 나오면 마지막 두 줄만 다시 실행합니다.
- 서버 안에서 직접(Session Manager, `sudo -i`): `cd /opt/harumaru && /opt/harumaru/bin/deploy.sh <SHA>` → 마지막 줄 `deployed <SHA>`.

## 부록 B. 문제 500 한 번에 공개 (환경을 처음 채울 때, 팀 실행)

관리자 화면으로 하면 호출 45번(15분에 10번 제한)과 30분마다 재로그인이 필요해 약 75분 걸립니다. 대신 서버 운영 명령 `api/dist/content/questionSetPublishCommand.js`(#837)를 SSM으로 돌립니다. 사장님 로그인은 필요 없습니다.

전제: 그 명령이 들어간 release가 배포됨, 태그 18 적재([question-import.v1.md](question-import.v1.md) 1단계), ACTIVE 관리자가 정확히 1명([first-admin.v1.md](first-admin.v1.md)). 명령은 그 관리자 이름으로 감사 기록을 남깁니다.

누가·어디서(제한):

- 이 명령은 관리자 화면과 달리 SSO 재인증 없이 승인·공개까지 합니다. 그래서 **서버에서 SSM Run Command로만** 돌립니다. HTTP 경로는 없고, 서버 밖(로컬·CI)에서 DB에 붙여 돌리지 않습니다.
- 실행하는 사람은 그 환경에 SSM 명령을 보낼 AWS 권한이 있는 팀(DevOps)뿐이고, 사장님 승인을 받은 뒤 한 번 돌립니다(dry run → confirm). GitHub Actions 배포 역할은 `AWS-RunShellScript`를 보낼 수 없습니다(`RunDeployOnHost`는 배포 문서만).
- 실행 기록: SSM 명령 기록(comment `question-set-publish <mode>`)과 출력 JSON의 `runId`로 묶인 감사 행.

`aws login`된 터미널, `infra/aws`(해당 환경 state)에서:

```sh
bash scripts/question-set-publish.sh dry-run   # 쓰기 없음, 계획만
bash scripts/question-set-publish.sh confirm   # 가져오기 → 검수 요청 → 승인 → 공개
```

- 스크립트는 SSM 상태를 최대 31분(서버 쪽 제한 30분 + 1분) 기다리고, 넘으면 command id를 찍고 실패로 끝납니다. 그때는 같은 id로 `aws ssm get-command-invocation`을 확인합니다.
- 스크립트는 `files/question-set-publish.sh`를 `AWS-RunShellScript`로 보냅니다(cloud-init이 설치하지 않으므로 terraform 변경 없음). 서버에서 배포된 SHA(`/opt/harumaru/current-release`)의 `content/question-imports/` 10개 파일을 내려받아(이미지에는 `content/`가 없음) 읽기 전용으로 붙이고, 관리자 화면과 같은 앱 로그인(`api.env`의 `DATABASE_URL`, 명령줄이 아닌 환경으로 전달)으로 실행합니다.
- 출력은 `status …`와 JSON 한 줄뿐입니다(이메일·비밀값·URL 없음). dry run 기대: `"event":"question_set_dry_run"`, 빈 `conflicts`·`issues`. confirm 기대: `"event":"question_set_published"`, 처음이면 `published` 500.
- 다시 돌려도 안전합니다: 이미 공개된 문제는 `skippedPublished`로 세고, 중간에 끊겼으면 남은 단계부터 이어 갑니다. 내용이 다른 같은 문제가 있으면 `conflicts`로 멈춥니다.
- `question_set_publish_failed`면 `code`를 보고 고친 뒤 dry run부터 다시 합니다. 확인은 [question-import.v1.md](question-import.v1.md) "Check"와 같습니다(공개본 500, Tag 18).
