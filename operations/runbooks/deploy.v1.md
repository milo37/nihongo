# 배포 v1 (기본 = 자동)

하루마루 배포의 단일 문서입니다. 평소 배포에는 사람이 명령을 붙여 넣지 않습니다. 사람 손이 필요한 일은 맨 아래 "사람만 하는 일"에만 있습니다. 수동 명령은 부록 A(비상·학습용)에만 둡니다.

## 1. 평소 흐름

| 순서 | 무엇                                                                                                                                                   | 누가       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1    | `dev`를 `main`에 통합(QA GO·CI 통과 뒤)                                                                                                                | 팀장       |
| 2    | **Release image**(`.github/workflows/release-image.yml`, 잡 `Publish runtime and migrate images`)가 ECR에 `<SHA>`·`<SHA>-migrate`를 올림               | 자동       |
| 3    | 같은 워크플로의 잡 **Deploy to STAGING**이 OIDC 역할로 SSM 문서 `harumaru-staging-deploy`(releaseId = 그 SHA)를 실행하고 `Success`를 기다림(최대 25분) | 자동       |
| 4    | 같은 잡이 `<STAGING 주소>/health/ready`가 200인지(응답에 `x-release-id`가 있으면 그 SHA와 같은지) 최대 5분 확인                                        | 자동       |
| 5    | PRODUCTION 배포: GitHub environment `production`의 **승인 버튼**을 누르면 같은 SHA를 배포 — **예정(아직 없음)**                                        | 사람(승인) |

- 결과는 GitHub Actions의 Release image 실행 화면에서 봅니다. 초록이면 STAGING에 그 SHA가 떠 있습니다.
- 저장소가 공개라 로그에는 상태와 `deploy.sh` 결과 줄(`deployed <SHA>`, `refusing: …`, `health check failed …`, `rolled back …`)만 남습니다.
- 한 번에 하나만 배포합니다(concurrency `staging-deploy`). 새 SHA는 앞 배포가 끝날 때까지 기다립니다.
- 서버 안에서 `deploy.sh`가 하는 일(DB 역할 확인 → 배포 전 백업 → migration → capability → API 교체 → health → 실패 시 직전 release로 롤백)은 [production-database.v1.md](production-database.v1.md) "Deploy order"에 있습니다.

### 실패했을 때

- `Publish` 실패: 이미지가 없으니 서버는 그대로입니다. 팀이 고쳐 다시 main에 올립니다.
- `Deploy to STAGING` 실패: `deploy.sh`가 직전 release로 되돌리거나(롤백), 새 API를 띄우기 전에 멈춥니다. 로그의 결과 줄을 팀(DevOps)이 보고 고칩니다. 같은 SHA를 다시 배포하려면 Actions에서 그 실행의 **Re-run failed jobs**를 누릅니다(사람 붙여넣기 없음).
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
2. 태그 18과 문제 500(가져오기·검수·승인·공개): [question-import.v1.md](question-import.v1.md)

## 4. PRODUCTION (예정)

- 계획: Release image 뒤에 잡 `Deploy to PRODUCTION`을 두고 GitHub environment `production`(필수 검토자 = 사장님)으로 묶습니다. 사장님은 Actions 화면에서 **Approve**만 누릅니다.
- 아직 구현하지 않았습니다. 그 전까지 PRODUCTION은 배포하지 않습니다(도메인·유료 전환 전, `infra/aws/README.md` "남는 위험").
- 구현할 때 필요: PRODUCTION 배포 역할 ARN·인스턴스·주소 변수, environment 생성(저장소 설정, 사람 승인), 같은 방식의 health 확인.

## 사람만 하는 일

반복 작업은 여기 없습니다. 모두 로그인·결제·승인처럼 사람만 할 수 있는 일입니다.

| 언제                     | 일                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 자동 배포 켤 때(1회)     | AWS에 로그인해 STAGING `instance_id`·`site_url` 두 값을 확인해 팀장에게 전달(값은 비밀 아님). 저장소 변수 등록은 팀장이 해도 됩니다. |
| 인프라가 바뀔 때만       | `terraform plan` 확인 후 `apply`(AWS 로그인·MFA)                                                                                     |
| 비밀값이 새로 생길 때만  | SSM SecureString 등록(값은 채팅·파일에 남기지 않음)                                                                                  |
| 환경을 처음 채울 때(1회) | 관리자 Google 계정으로 로그인, 문제 가져오기 화면에서 검수·승인·공개                                                                 |
| PRODUCTION 전(1회)       | 도메인 구입, AWS 유료 전환, CloudFront 요금제 가입, Google OAuth 주소 등록, 경보 메일 구독 확인                                      |
| PRODUCTION 배포마다      | Actions의 **Approve** 버튼 1번(구현 뒤)                                                                                              |

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
