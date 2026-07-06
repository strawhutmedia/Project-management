-- Cache scene action body so the Production Board PDF can render the
-- italic action snippet under the slug (StudioBinder-style preview).
-- Populated by the .fdx parser the next time a script is uploaded;
-- existing scenes get NULL until then.
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS action_text TEXT;
