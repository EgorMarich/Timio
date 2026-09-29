-- v0.7.5 Retention Attribution
ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS booked_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL;

ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS completed_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_status_idx
  ON campaign_recipients (campaign_id, status);

CREATE INDEX IF NOT EXISTS campaign_recipients_client_campaign_idx
  ON campaign_recipients (business_id, client_id, campaign_id);

CREATE INDEX IF NOT EXISTS appointments_client_created_at_idx
  ON appointments (business_id, client_id, created_at);
