// SQL kept in a module so the same migration ships inside Neon/Netlify bundles.
export const schema = `
CREATE TABLE IF NOT EXISTS mvp_state (id INTEGER PRIMARY KEY CHECK(id=1), content JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS mvp_accounts (user_id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mvp_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES mvp_accounts(user_id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS mvp_sessions_expiry ON mvp_sessions(expires);
CREATE TABLE IF NOT EXISTS mvp_rate_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS mvp_neon_identities (subject TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE);
`;
