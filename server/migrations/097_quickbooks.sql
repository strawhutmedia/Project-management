-- QuickBooks Online connection (OAuth2). Single-row table holding the tokens
-- for the owner's connected company. Access tokens are short-lived (~1h) and
-- refreshed automatically; the refresh token lasts ~100 days. Used by the
-- AR side of invoicing: drafting + sending client estimates/invoices.
CREATE TABLE IF NOT EXISTS quickbooks_connection (
  id INT PRIMARY KEY DEFAULT 1,
  realm_id TEXT NOT NULL,                    -- QuickBooks company id
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  connected_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quickbooks_connection_singleton CHECK (id = 1)
);
