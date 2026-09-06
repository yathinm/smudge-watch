PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  retailer TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  poll_interval_seconds INTEGER NOT NULL CHECK (poll_interval_seconds >= 60),
  next_poll_at INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER,
  last_attempt_at INTEGER,
  baseline_completed_at INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_notified INTEGER NOT NULL DEFAULT 0 CHECK (failure_notified IN (0, 1)),
  etag TEXT,
  last_modified TEXT,
  last_http_status INTEGER,
  last_error TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_due
  ON sources(enabled, next_poll_at);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  retailer TEXT NOT NULL,
  product_key TEXT NOT NULL,
  external_id TEXT,
  name TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  image_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(retailer, product_key)
);

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_key TEXT NOT NULL,
  external_id TEXT,
  sku TEXT,
  name TEXT NOT NULL,
  size TEXT,
  price_minor INTEGER,
  currency TEXT,
  availability TEXT NOT NULL,
  purchase_url TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(product_id, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_variants_product
  ON variants(product_id);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  checked_at INTEGER NOT NULL,
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  http_status INTEGER,
  content_hash TEXT,
  parser_confidence TEXT,
  duration_ms INTEGER NOT NULL,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_observations_source_time
  ON observations(source_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS events (
  fingerprint TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  retailer TEXT NOT NULL,
  product_key TEXT NOT NULL,
  variant_key TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_created
  ON events(created_at DESC);

CREATE TABLE IF NOT EXISTS email_deliveries (
  event_fingerprint TEXT PRIMARY KEY REFERENCES events(fingerprint) ON DELETE CASCADE,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  provider_message_id TEXT,
  last_error TEXT,
  accepted_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_pending
  ON email_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS leases (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  sources_checked INTEGER NOT NULL DEFAULT 0,
  sources_succeeded INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  events_created INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_started
  ON monitor_runs(started_at DESC);
