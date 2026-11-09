# Question import v1 (STAGING and PRODUCTION)

How to put the reviewed question set (250 questions, 18 tags) on a new
environment after its first deploy: load the tag list, import the five files,
then request review, approve and publish in bulk from the admin question list.
The same path ran end to end on an empty local database (see "Local
rehearsal").

Order after the first deploy: first admin (`first-admin.v1.md`), then this
runbook. The API starts without tags; the import refuses unknown tags.

## Inputs (in the repository)

| What            | File                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tag list (18)   | `content/taxonomy/tags.v2.json`                                                                                                     |
| Questions (250) | `content/question-imports/n5.v1.json`, `n4.v1.json`, `n3.v1.json`, `n2.v1.json`, `n1.v1.json` (50 each, #785); 100 per file at most |

Use the files of the release that is deployed (`/opt/harumaru/current-release`).

## 1. Load the tag list (operator, SSM Run Command)

On the host, fetch the file of the deployed release and run the tag command
from `production-database.v1.md` ("Tag list load"):

```bash
cd /opt/harumaru
release="$(cat current-release)"
install -d -m 755 content
curl -fsS "https://raw.githubusercontent.com/milo37/nihongo/${release}/content/taxonomy/tags.v2.json" \
  -o content/tags.v2.json
chmod 644 content/tags.v2.json        # read by uid 1000 in the container
/opt/harumaru/bin/render-env.sh
docker compose --profile operator run --rm --no-deps -T \
  -v /opt/harumaru/content/tags.v2.json:/run/tags.v2.json:ro \
  -e TAG_LIST_FILE=/run/tags.v2.json \
  --entrypoint node capability api/dist/content/tagLoadCommand.js
```

- Dry run first: expect `"tagCount":18`, `"created":18` on an empty database,
  `"conflicts":[]`.
- Then the same command with `-e TAG_LOAD_CONFIRM=LOAD_TAG_LIST`: expect
  `tag_list_loaded` with `"created":18`.
- Run it through `aws ssm send-command --document-name AWS-RunShellScript`
  as in `first-admin.v1.md`, and read the line with
  `aws ssm get-command-invocation`.

## 2. Import the five files (admin, browser)

As the first admin, open `/admin/questions/import`. For each file, in the
order of the table above:

1. Choose the file under **JSON 파일** and press **쓰기 없이 검증**. Expect
   **검증 통과** and the item count. Nothing is written yet.
2. Press **동일 검증 결과 원자 적용**. If it asks for a fresh Google sign-in,
   do it, come back, choose the same file and validate again (the page resets).
3. Expect "N개 초안을 원자적으로 만들었습니다." The file's questions now exist
   as drafts.

An `UNKNOWN_TAG` issue means the tag list is missing or older than the file;
fix step 1 and validate again. A file is applied whole or not at all.

## 3. Request review, approve, publish (admin, browser)

Open `/admin/questions` and set **한 페이지에** to **100개씩** (three pages:
100, 100, 50). On each page:

| Step           | Select                                                        | Press                                         | Calls per page                  |
| -------------- | ------------------------------------------------------------- | --------------------------------------------- | ------------------------------- |
| Review request | header checkbox **이 페이지에서 고를 수 있는 문제 모두 선택** | **내 초안 N개 검수 요청** → **N개 검수 요청** | 5 (sent in batches of 20, #718) |
| Approve        | same                                                          | **검수 중 N개 승인** → **N개 승인**           | 1                               |
| Publish        | same                                                          | **승인된 N개 공개** → **N개 공개**            | 1                               |

Do all three pages of one step before the next step. Each dialog lists the
result per question; expect no failures.

### Rate limit

Import apply, review request batches, approval batches and publication
batches share one limit: **10 calls per 15 minutes**, per admin and per IP
(`ADMIN_SENSITIVE`, `apps/api/src/admin/adminCommandRateLimiter.ts`).

| Work                                   | Calls  |
| -------------------------------------- | ------ |
| Import apply (5 files)                 | 5      |
| Review request (250 drafts, 20 a call) | 13     |
| Approve (3 pages)                      | 3      |
| Publish (3 pages)                      | 3      |
| **Total**                              | **24** |

That is three 15-minute windows, about 35 minutes:

1. Import apply 5 + review request page 1 (5).
2. Wait 15 minutes. Review request pages 2 and 3 (5 + 3) + approve pages 1
   and 2 (2).
3. Wait 15 minutes. Approve page 3 (1) + publish 3.

At the limit the dialog shows **요청이 너무 많습니다** (HTTP 429), and the
review request marks the batches it did not send as not sent. Wait 15
minutes, select the page again and press the same button: questions already
done no longer count in the button. After a wait the admin may have to sign in
with Google again (fresh sign-in).

## Check

- `/admin/questions` with the filter **공개본 있음** shows 250.
- A learner account starts an N5 vocabulary session and gets questions.
- On the host (optional):
  `docker compose exec -T postgres psql -U postgres -d nihongo -c 'SELECT count(*) FROM "Question" WHERE "currentPublishedVersionId" IS NOT NULL'`
  returns 250, and `SELECT count(*) FROM "Tag"` returns 18.

## If something fails

- **Validation errors other than `UNKNOWN_TAG`:** stop and hand the file name
  and the issue list to the content owner. Do not edit the file on the host.
- **변경 충돌 or 검수 중 아님 in a result list:** reload the list, select the
  page again and press the button again.
- **A wrong question was published:** use **공개 중단·보관** on that question
  (one call each, same limit). Imports cannot be undone as a whole.

## Local rehearsal (JLP-735, 2026-11-07)

Empty TEST-shaped database at dev `25f56132`, the operator commands and the
HTTP API the apps use: tag load created 18, the Tag table had 18 rows and none
of the old v1 names; the five files validated with 0 issues (`UNKNOWN_TAG` 0) and applied 373 drafts; all 373 were reviewed, approved and published; a
learner studied, submitted, saw wrong-answer notes and tag weaknesses. That run
used single-question calls and cleared the rate limit table between them; the
bulk screens above (#711, #718) replace that.
