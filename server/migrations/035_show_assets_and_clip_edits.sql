-- Per-show photo asset library + per-clip edit overrides.
--
-- show_assets: small photo uploads (guest headshots, BTS photos,
-- show logos) the team can attach to text-post templates. Stored in
-- Dropbox alongside the show's other content under
-- slate-assets/<projectId>/<filename>. The DB row tracks the path
-- plus enough metadata (kind, width/height, label) for the renderer
-- to slot the asset into the right template variant.
CREATE TABLE IF NOT EXISTS show_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dropbox_path text NOT NULL,
  file_name text NOT NULL,
  -- 'guest' | 'host' | 'bts' | 'logo' | 'other' — drives which
  -- templates the asset is eligible for.
  kind text NOT NULL DEFAULT 'other',
  label text,
  width int,
  height int,
  bytes bigint,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_show_assets_project ON show_assets(project_id, created_at DESC);

-- clip_edits: per-clip overrides applied by the in-Slate clip editor.
-- One row per (clip, version) so users can save multiple edits of the
-- same clip. The latest version is the active one; older rows stay
-- around as undo history.
CREATE TABLE IF NOT EXISTS clip_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  -- 0-based; higher = newer. The renderer / UI picks max(version) as
  -- the active edit.
  version int NOT NULL DEFAULT 0,
  -- Trim window in seconds relative to the source clip's start.
  -- NULL means "use the whole clip."
  trim_start_s numeric,
  trim_end_s numeric,
  -- Override the burned-in captions wholesale, or null to keep
  -- OpusClip's text. Stored as a list of timed cues so the editor
  -- can re-render captions on the cropped output.
  caption_overrides jsonb,
  -- Crop region as fractions [0,1] of the source frame. NULL = no crop.
  crop_x numeric,
  crop_y numeric,
  crop_w numeric,
  crop_h numeric,
  -- Dropbox path of the rendered output, if/once the edit has been
  -- re-encoded by our ffmpeg pipeline. Null until rendered.
  output_dropbox_path text,
  output_rendered_at timestamptz,
  -- Set to 'failed' if a render attempt errored; the error text
  -- lives in render_error so the UI can surface it.
  render_state text NOT NULL DEFAULT 'draft'
    CHECK (render_state IN ('draft', 'rendering', 'done', 'failed')),
  render_error text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clip_edits_clip ON clip_edits(clip_id, version DESC);
