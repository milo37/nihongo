-- Phase 3 Slice 2: database-level authentication and guest credential integrity.

BEGIN;

CREATE UNIQUE INDEX "User_email_normalized_key"
  ON "User" (lower("email"));

ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized_check" CHECK (
    "email" = lower("email")
    AND "email" = btrim("email")
  );

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_valid_expiry" CHECK (
    "expiresAt" > "createdAt"
  );

ALTER TABLE "RateLimit"
  ADD CONSTRAINT "RateLimit_non_negative_check" CHECK (
    "count" >= 0
    AND "lastRequest" >= 0
  );

ALTER TABLE "GuestPrincipal"
  ADD CONSTRAINT "GuestPrincipal_digest_format_check" CHECK (
    "tokenDigest" ~ '^[0-9a-f]{64}$'
  );

COMMIT;
