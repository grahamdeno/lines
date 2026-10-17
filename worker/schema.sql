-- Lines relay database (Cloudflare D1). Apply with:
--   npx wrangler d1 execute lines --remote --file=worker/schema.sql
CREATE TABLE IF NOT EXISTS polls (
  token TEXT PRIMARY KEY,        -- unguessable, from the vote link
  admin_hash TEXT NOT NULL,      -- SHA-256 of the manager's secret
  game TEXT NOT NULL,            -- JSON: team, opponent, start, end, place, address, tz
  players TEXT NOT NULL,         -- JSON: names to pick from
  expires INTEGER NOT NULL,      -- ms; 60 days after the game
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  token TEXT NOT NULL,
  key TEXT NOT NULL,             -- the name, lowercased, without punctuation
  name TEXT NOT NULL,
  v TEXT NOT NULL CHECK (v IN ('in', 'maybe', 'out')),
  at INTEGER NOT NULL,
  PRIMARY KEY (token, key)
);
