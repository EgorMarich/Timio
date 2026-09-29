ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
CREATE TYPE "public"."user_status" AS ENUM('pending_email_verification','active','suspended','deleted');
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'pending_email_verification' NOT NULL;
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp;
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;
CREATE TYPE "public"."identity_provider" AS ENUM('google','vk');
CREATE TABLE "user_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "provider" "identity_provider" NOT NULL,
  "provider_user_id" varchar(255) NOT NULL,
  "provider_email" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "user_identities_provider_user_idx" ON "user_identities" ("provider", "provider_user_id");
CREATE UNIQUE INDEX "user_identities_user_provider_idx" ON "user_identities" ("user_id", "provider");
CREATE TABLE "auth_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "type" varchar(32) NOT NULL,
  "token_hash" varchar(128) NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "auth_tokens_user_type_idx" ON "auth_tokens" ("user_id", "type");
CREATE INDEX "auth_tokens_expires_idx" ON "auth_tokens" ("expires_at");

-- Existing demo/legacy users are treated as already verified so the migration does not lock existing environments.
UPDATE "users" SET "status"='active', "email_verified_at"=COALESCE("email_verified_at", now()) WHERE "status"='pending_email_verification';
