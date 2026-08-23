-- Persistent per-episode carousel decks.
--
-- Carousels graduate from the /carousel-preview design lab to a
-- standard every-episode deliverable for every show (the Soul & Science
-- LinkedIn playbook, productized): the upload-and-go autopipeline
-- generates a deck automatically once the transcript lands, and the
-- team reviews / edits / exports (Instagram ZIP or LinkedIn PDF) from
-- the episode page.
--
-- One current deck per episode — regeneration overwrites in place.
CREATE TABLE IF NOT EXISTS carousel_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  transcript_id uuid REFERENCES transcripts(id) ON DELETE SET NULL,
  -- { slides: RawDeckSlide[], asset_requests: [...] } — the server
  -- shape; the client adapts to SlideSpec[] at render time.
  deck jsonb,
  status text NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'generated', 'failed')),
  error text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (song_id)
);

CREATE INDEX IF NOT EXISTS idx_carousel_decks_project
  ON carousel_decks(project_id, updated_at DESC);
