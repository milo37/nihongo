---
name: design-skill
description: Web Interface Guidelines 준수 여부를 검토하기 위한 UI 코드 리뷰 스킬. "UI 검토해줘", "접근성 확인해줘", "디자인 감사해줘", "UX 검토해줘", "베스트 프랙티스에 맞는지 확인해줘", "디자인 최적화해줘" 와 같은 요청 시 사용됩니다.
---

# Web Interface Guidelines

Web Interface Guidelines 기준에 따라 파일을 검토합니다.

## 동작 방식 (How It Works)

1. 아래 소스 URL에서 **최신 가이드라인을 가져옵니다**
2. 지정된 파일을 읽습니다
   (또는 사용자에게 검토할 파일/패턴을 요청합니다)
3. 가져온 가이드라인의 **모든 규칙을 적용하여 점검합니다**
4. 결과를 간결한 `file:line` 형식으로 출력합니다

## 가이드라인 소스 (Guidelines Source)

매 리뷰마다 항상 최신 가이드라인을 가져옵니다:

```text
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

`WebFetch`를 사용해 최신 규칙을 가져옵니다.
가져온 콘텐츠에는 **모든 규칙과 출력 형식 지침**이 포함되어 있습니다.

만약, 찾아오지 못했다면 재요청합니다.

## 사용 방법 (Usage)

사용자가 파일 또는 패턴 인자를 제공한 경우:

1. 위 소스 URL에서 가이드라인을 가져옵니다
2. 지정된 파일을 읽습니다
3. 가져온 가이드라인의 모든 규칙을 적용합니다
4. 가이드라인에 명시된 형식으로 결과를 출력합니다

검토할 파일이 지정되지 않은 경우,
사용자에게 **어떤 파일을 검토할지 요청**합니다.
