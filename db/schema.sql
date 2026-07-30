-- pazetracker Postgres schema
-- Maps to current JSON/ndjson stores:
--   data/user-cards.json
--   data/order-reports.ndjson
--   data/community-stats.json
--   data/promo-refund-reports.ndjson
--
-- Clerk user ids are text (e.g. user_...).
-- Promo value is $10; dollars can be derived in app code.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Synced tracker cards (per Clerk user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  bank_id         TEXT NOT NULL,
  label           TEXT NOT NULL,
  remaining_count SMALLINT NOT NULL DEFAULT 10
                    CHECK (remaining_count BETWEEN 0 AND 10),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_cards_user_id_idx ON user_cards (user_id);
CREATE INDEX IF NOT EXISTS user_cards_user_bank_label_idx ON user_cards (user_id, bank_id, label);

-- Optional: one label per bank per user
-- CREATE UNIQUE INDEX user_cards_user_bank_label_uidx
--   ON user_cards (user_id, bank_id, lower(label));

-- ---------------------------------------------------------------------------
-- One row per promo use on a card (#10 earliest … #1 latest)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promo_uses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id       UUID NOT NULL REFERENCES user_cards (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  promo_number  SMALLINT NOT NULL CHECK (promo_number BETWEEN 1 AND 10),
  used_at       DATE NOT NULL DEFAULT (CURRENT_DATE),
  received_at   DATE,
  place_id      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (card_id, promo_number)
);

CREATE INDEX IF NOT EXISTS promo_uses_user_id_idx ON promo_uses (user_id);
CREATE INDEX IF NOT EXISTS promo_uses_card_id_idx ON promo_uses (card_id);
CREATE INDEX IF NOT EXISTS promo_uses_pending_idx ON promo_uses (card_id)
  WHERE received_at IS NULL;
CREATE INDEX IF NOT EXISTS promo_uses_received_idx ON promo_uses (received_at)
  WHERE received_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Crowdsourced Clover order yes/no reports (anonymous OK)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_reports (
  id                 BIGSERIAL PRIMARY KEY,
  place_id           TEXT NOT NULL,
  ordering_url       TEXT,
  success            BOOLEAN NOT NULL,
  card_institution   TEXT,
  card_label         TEXT,
  reporter_user_id   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_reports_place_id_idx ON order_reports (place_id);
CREATE INDEX IF NOT EXISTS order_reports_created_at_idx ON order_reports (created_at DESC);

-- Report detail columns (issue reason, device, browser)
ALTER TABLE order_reports ADD COLUMN IF NOT EXISTS issue_reason TEXT;
ALTER TABLE order_reports ADD COLUMN IF NOT EXISTS device TEXT;
ALTER TABLE order_reports ADD COLUMN IF NOT EXISTS browser TEXT;

-- Per-place aggregate (updated atomically with each report)
CREATE TABLE IF NOT EXISTS place_order_stats (
  place_id          TEXT PRIMARY KEY,
  yes_count         INTEGER NOT NULL DEFAULT 0 CHECK (yes_count >= 0),
  no_count          INTEGER NOT NULL DEFAULT 0 CHECK (no_count >= 0),
  last_reported_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Global community counters (single row, atomic increments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_stats (
  id                       SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  promos_redeemed          INTEGER NOT NULL DEFAULT 0 CHECK (promos_redeemed >= 0),
  promos_refund_confirmed  INTEGER NOT NULL DEFAULT 0 CHECK (promos_refund_confirmed >= 0),
  successful_orders        INTEGER NOT NULL DEFAULT 0 CHECK (successful_orders >= 0),
  failed_orders            INTEGER NOT NULL DEFAULT 0 CHECK (failed_orders >= 0),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (promos_refund_confirmed <= promos_redeemed)
);

INSERT INTO community_stats (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Helpers: keep updated_at fresh
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_cards_set_updated_at ON user_cards;
CREATE TRIGGER user_cards_set_updated_at
  BEFORE UPDATE ON user_cards
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS community_stats_set_updated_at ON community_stats;
CREATE TRIGGER community_stats_set_updated_at
  BEFORE UPDATE ON community_stats
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ---------------------------------------------------------------------------
-- Example atomic writes (for server code later)
-- ---------------------------------------------------------------------------
-- Log successful order + bump community pending promo:
--   INSERT INTO order_reports (...);
--   INSERT INTO place_order_stats AS p (place_id, yes_count, last_reported_at)
--     VALUES ($place, 1, now())
--     ON CONFLICT (place_id) DO UPDATE
--       SET yes_count = p.yes_count + 1,
--           last_reported_at = excluded.last_reported_at;
--   UPDATE community_stats
--     SET successful_orders = successful_orders + 1,
--         promos_redeemed = promos_redeemed + 1
--     WHERE id = 1;
--
-- Mark credit received (only if still pending):
--   UPDATE promo_uses
--     SET received_at = $date
--     WHERE id = $use_id AND received_at IS NULL
--     RETURNING id;
--   -- if a row was updated:
--   UPDATE community_stats
--     SET promos_refund_confirmed = promos_refund_confirmed + 1
--     WHERE id = 1
--       AND promos_refund_confirmed < promos_redeemed;
--
-- Community tracker dollars:
--   pending_credits   = (promos_redeemed - promos_refund_confirmed) * 10
--   confirmed_credits = promos_refund_confirmed * 10
--   promos_reported   = promos_redeemed
