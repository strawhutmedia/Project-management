-- Lead alerts: for lists that are sales pipelines (Straw Hut service
-- leads) rather than fan lists, email the admin the moment a contact
-- is captured — leads go cold in hours, not days.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS audience_lead_alerts boolean NOT NULL DEFAULT false;
