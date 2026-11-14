# 기여 규칙 (GitHub 이름 규칙)

이 문서가 이슈·PR·커밋·브랜치 이름 규칙의 원본입니다. 2026-11-14부터 **새로 만드는 것**에 적용합니다. 지난 이슈·PR·커밋·브랜치는 그대로 두고, 고치려고 새 이슈를 만들지 않습니다.

## 제목

이슈·PR·커밋 제목은 영어 한 줄로 씁니다.

```
type(area): what
```

| 자리   | 값                                                                  |
| ------ | ------------------------------------------------------------------- |
| `type` | `feat`, `fix`, `refactor`, `security`, `chore`, `content`           |
| `area` | `web`, `admin`, `api`, `infra`                                      |
| `what` | 무엇을 했는지 영어 소문자(고유명사 제외)로 시작하는 5단어 안팎 요약 |

- `what`은 5단어 안팎으로 짧게 씁니다. 이유·조건·상세는 제목에 넣지 않고 본문에 씁니다.
  - 좋은 예: `feat(web): hide language menu`, `feat(web): Japanese explanations`
  - 피할 예: `feat(web): hide the language menu until Japanese explanations are ready for every level`
- PR 제목과 커밋 제목은 끝에 이슈 번호를 붙입니다: `fix(web): keep question push in build (#123)`
- 이슈 제목에는 번호를 붙이지 않습니다: `fix(web): keep question push in build`
- 제목·커밋·브랜치에 `JLP-` 카드 키나 `[FE]` 같은 접두어를 쓰지 않습니다. 카드와의 연결은 카드 쪽에 이슈 번호를 적어서 합니다(이슈 1개 ↔ 카드 1개).

`type` 고르기:

- `feat`: 사용자가 느끼는 새 기능이나 변경
- `fix`: 버그 고침
- `refactor`: 동작이 바뀌지 않는 코드 정리
- `security`: 보안 관련 변경
- `chore`: 빌드·CI·문서·설정 같은 운영 일
- `content`: 문제·해설 같은 학습 콘텐츠

## 본문

- 이슈·PR 본문은 한국어로 씁니다.
- PR 본문 첫 줄은 `Refs #이슈번호`입니다. `Closes`·`Fixes`는 쓰지 않습니다(이슈는 확인을 마친 담당이 닫습니다).
- PR 본문 형식은 `.github/pull_request_template.md`, 이슈 형식은 `.github/ISSUE_TEMPLATE/`를 따릅니다.

## 브랜치

```
type/<이슈번호>-<slug>
```

- 예: `fix/123-question-push-build`
- `slug`는 영어 소문자와 `-`만 씁니다.
- 예전 `codex/jlp-*` 형식은 새 브랜치에 쓰지 않습니다.

## 마일스톤과 라벨

- 마일스톤: `Pre-launch`(공개 전에 끝낼 일), `Post-launch`(공개 뒤에 할 일), `On hold`(보류).
- 라벨: `bug`, `enhancement`, `refactor`, `security`, `needs-decision`.
