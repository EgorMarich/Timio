CREATE TYPE "onboarding_event_type" AS ENUM ('business_created', 'service_created', 'staff_created', 'schedule_configured', 'client_created', 'appointment_created', 'activation_completed');

CREATE TABLE "onboarding_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event" "onboarding_event_type" NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "onboarding_events_business_created_idx" ON "onboarding_events" ("business_id", "created_at");
CREATE INDEX "onboarding_events_business_event_idx" ON "onboarding_events" ("business_id", "event", "created_at");
