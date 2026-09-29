-- v0.7.2 Retention Intelligence
-- Marketing preference lives on the client; campaign recipients are immutable audit snapshots.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS marketing_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS marketing_consent_at timestamp;

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  error text,
  sent_at timestamp,
  booked_at timestamp,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_idx
  ON campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_recipients_business_client_idx
  ON campaign_recipients (business_id, client_id, created_at);
CREATE INDEX IF NOT EXISTS campaign_recipients_client_sent_idx
  ON campaign_recipients (client_id, sent_at);

-- Keep retention indexes available on fresh installations as well.
CREATE INDEX IF NOT EXISTS appointments_business_client_status_idx
  ON appointments (business_id, client_id, status);
CREATE INDEX IF NOT EXISTS appointments_business_start_idx
  ON appointments (business_id, start_at);
CREATE INDEX IF NOT EXISTS clients_business_last_visit_idx
  ON clients (business_id, last_visit_at);
