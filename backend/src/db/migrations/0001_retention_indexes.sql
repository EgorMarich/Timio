-- Retention queries scan appointments by tenant/client/status.
CREATE INDEX IF NOT EXISTS appointments_business_client_status_idx
  ON appointments (business_id, client_id, status);

CREATE INDEX IF NOT EXISTS appointments_business_start_idx
  ON appointments (business_id, start_at);

CREATE INDEX IF NOT EXISTS clients_business_last_visit_idx
  ON clients (business_id, last_visit_at);
