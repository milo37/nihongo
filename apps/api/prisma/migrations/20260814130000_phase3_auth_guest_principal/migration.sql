-- Phase 3 Slice 2: Better Auth 1.6 core persistence, shared rate limiting,
-- signed guest principals, and creator provenance ownership.

BEGIN;

CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "UserAccountStatus" AS ENUM (
  'ACTIVE',
  'DELETION_PENDING',
  'DELETED'
);

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "image" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "targetLevel" "JlptLevel",
  "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "deletedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "token" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" UUID NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
  "id" UUID NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ(3),
  "refreshTokenExpiresAt" TIMESTAMPTZ(3),
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Verification" (
  "id" UUID NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateLimit" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL,
  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuestPrincipal" (
  "id" UUID NOT NULL,
  "tokenDigest" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestPrincipal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuestPrincipal_valid_expiry" CHECK (
    "expiresAt" > "createdAt"
    AND "expiresAt" <= "createdAt" + INTERVAL '7 days'
  )
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_accountStatus_idx" ON "User"("role", "accountStatus");
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE UNIQUE INDEX "Account_providerId_accountId_key"
  ON "Account"("providerId", "accountId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
CREATE INDEX "Verification_expiresAt_idx" ON "Verification"("expiresAt");
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");
CREATE UNIQUE INDEX "GuestPrincipal_tokenDigest_key"
  ON "GuestPrincipal"("tokenDigest");
CREATE INDEX "GuestPrincipal_expiresAt_idx" ON "GuestPrincipal"("expiresAt");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Account"
  ADD CONSTRAINT "Account_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Question"
  ADD CONSTRAINT "Question_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuestionVersion"
  ADD CONSTRAINT "QuestionVersion_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Question"
  ADD CONSTRAINT "Question_creator_provenance_check" CHECK (
    ("createdByLabelSnapshot" = 'SYSTEM_SEED' AND "createdByUserId" IS NULL)
    OR ("createdByLabelSnapshot" = 'ACTIVE_ADMIN' AND "createdByUserId" IS NOT NULL)
    OR ("createdByLabelSnapshot" = 'DELETED_ADMIN' AND "createdByUserId" IS NULL)
  );

ALTER TABLE "QuestionVersion"
  ADD CONSTRAINT "QuestionVersion_creator_provenance_check" CHECK (
    ("createdByLabelSnapshot" = 'SYSTEM_SEED' AND "createdByUserId" IS NULL)
    OR ("createdByLabelSnapshot" = 'ACTIVE_ADMIN' AND "createdByUserId" IS NOT NULL)
    OR ("createdByLabelSnapshot" = 'DELETED_ADMIN' AND "createdByUserId" IS NULL)
  );

CREATE OR REPLACE FUNCTION "validate_question_version_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  option_count INTEGER;
  tag_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'QuestionVersion must be inserted as DRAFT.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."createdByUserId" IS NOT NULL
    AND NEW."createdByUserId" IS NULL
    AND OLD."createdByLabelSnapshot" = 'ACTIVE_ADMIN'
    AND NEW."createdByLabelSnapshot" = 'DELETED_ADMIN'
    AND (
      to_jsonb(NEW) - 'createdByUserId' - 'createdByLabelSnapshot'
    ) = (
      to_jsonb(OLD) - 'createdByUserId' - 'createdByLabelSnapshot'
    ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'RETIRED' THEN
    RAISE EXCEPTION 'RETIRED QuestionVersion is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'PUBLISHED' THEN
    IF NEW."status" <> 'RETIRED' THEN
      RAISE EXCEPTION 'PUBLISHED QuestionVersion is immutable.'
        USING ERRCODE = '23514';
    END IF;

    PERFORM 1
    FROM "Question"
    WHERE "id" = OLD."questionId"
    FOR UPDATE;

    IF EXISTS (
      SELECT 1
      FROM "Question"
      WHERE "currentPublishedVersionId" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'Current QuestionVersion must be unlinked before retirement.'
        USING ERRCODE = '23514';
    END IF;

    IF (
      to_jsonb(NEW) - 'status' - 'retiredAt' - 'updatedAt'
    ) <> (
      to_jsonb(OLD) - 'status' - 'retiredAt' - 'updatedAt'
    ) THEN
      RAISE EXCEPTION 'Retirement cannot change published content.'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'DRAFT' THEN
    IF NEW."status" = 'RETIRED' THEN
      RAISE EXCEPTION 'DRAFT QuestionVersion cannot be retired.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'PUBLISHED' THEN
      SELECT COUNT(*) INTO option_count
      FROM "QuestionOption"
      WHERE "questionVersionId" = NEW."id";

      SELECT COUNT(*) INTO tag_count
      FROM "QuestionVersionTag"
      WHERE "questionVersionId" = NEW."id";

      IF option_count <> 4 THEN
        RAISE EXCEPTION 'Published QuestionVersion requires exactly four options.'
          USING ERRCODE = '23514';
      END IF;

      IF tag_count < 1 THEN
        RAISE EXCEPTION 'Published QuestionVersion requires at least one tag.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "anonymize_question_creator_on_user_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE "Question"
  SET
    "createdByUserId" = NULL,
    "createdByLabelSnapshot" = 'DELETED_ADMIN'
  WHERE "createdByUserId" = OLD."id";

  UPDATE "QuestionVersion"
  SET
    "createdByUserId" = NULL,
    "createdByLabelSnapshot" = 'DELETED_ADMIN'
  WHERE "createdByUserId" = OLD."id";

  RETURN OLD;
END;
$function$;

CREATE TRIGGER "User_anonymize_question_creator_before_delete"
BEFORE DELETE ON "User"
FOR EACH ROW
EXECUTE FUNCTION "anonymize_question_creator_on_user_delete"();

COMMIT;
