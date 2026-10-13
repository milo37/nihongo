BEGIN;

CREATE TABLE "Bookmark" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Bookmark_userId_questionId_key" UNIQUE ("userId", "questionId"),
  CONSTRAINT "Bookmark_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Bookmark_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "Question"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Bookmark_userId_createdAt_id_idx"
  ON "Bookmark"("userId", "createdAt" DESC, "id");

CREATE INDEX "Bookmark_userId_createdAt_questionId_idx"
  ON "Bookmark"("userId", "createdAt" DESC, "questionId");

CREATE INDEX "Bookmark_questionId_id_idx"
  ON "Bookmark"("questionId", "id");

COMMIT;
