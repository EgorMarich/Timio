CREATE TABLE IF NOT EXISTS "auth_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "event" varchar(64) NOT NULL,
  "ip_address" varchar(64),
  "user_agent" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "auth_audit_user_created_idx" ON "auth_audit_events" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "auth_audit_event_created_idx" ON "auth_audit_events" ("event", "created_at");
CREATE INDEX IF NOT EXISTS "auth_tokens_user_created_idx" ON "auth_tokens" ("user_id", "created_at");
