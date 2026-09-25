import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const migrations: string[] = [
  // 1 — schéma initial
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );
  CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    action TEXT NOT NULL,
    detail TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE providers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','openai_compatible')),
    base_url TEXT,
    api_key_enc TEXT,
    api_key_hint TEXT,
    default_model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE agents (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    role_title TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    temperature REAL,
    max_tokens INTEGER NOT NULL DEFAULT 16000,
    effort TEXT,
    color TEXT NOT NULL DEFAULT '#c9a227',
    tools TEXT NOT NULL DEFAULT '[]',
    web_search INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    filename TEXT,
    mime TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('text','pdf','image')),
    size INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '',
    source TEXT,
    notes TEXT,
    content TEXT NOT NULL DEFAULT '',
    file_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE doc_chunks (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    content TEXT NOT NULL
  );
  CREATE INDEX doc_chunks_doc ON doc_chunks(document_id);
  CREATE VIRTUAL TABLE doc_chunks_fts USING fts5(content, content='doc_chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
  CREATE TRIGGER doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
    INSERT INTO doc_chunks_fts(rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
    INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
  END;

  CREATE TABLE memories (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0.5,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','confirmed','refuted','archived')),
    pinned INTEGER NOT NULL DEFAULT 0,
    author_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    author_label TEXT,
    session_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE VIRTUAL TABLE memories_fts USING fts5(title, content, tags, content='memories', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES ('delete', old.id, old.title, old.content, old.tags);
  END;
  CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES ('delete', old.id, old.title, old.content, old.tags);
    INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
  END;

  CREATE TABLE research_sessions (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'roundtable' CHECK (mode IN ('roundtable','orchestrated')),
    agent_ids TEXT NOT NULL DEFAULT '[]',
    lead_agent_id INTEGER,
    rounds_per_run INTEGER NOT NULL DEFAULT 2,
    context_doc_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'idle',
    summary TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('user','agent','tool','system')),
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    agent_name TEXT,
    content TEXT NOT NULL DEFAULT '',
    thinking TEXT,
    tool_name TEXT,
    tool_input TEXT,
    tool_output TEXT,
    parent_id INTEGER,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX messages_session ON messages(session_id, id);

  CREATE TABLE corpus_pages (
    folio TEXT PRIMARY KEY,
    ord INTEGER NOT NULL,
    quire TEXT,
    panel TEXT,
    illustration TEXT,
    language TEXT,
    hand TEXT,
    header TEXT
  );
  CREATE TABLE corpus_lines (
    id INTEGER PRIMARY KEY,
    folio TEXT NOT NULL,
    ord INTEGER NOT NULL,
    locus TEXT NOT NULL,
    locus_type TEXT,
    transcriber TEXT,
    raw TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX corpus_lines_folio ON corpus_lines(folio, ord);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

function migrate() {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
migrate();

export function getSetting(key: string): string | undefined {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}
export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Transforme une requête libre en requête FTS5 sûre (termes OR, préfixes). */
export function ftsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 16);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
}
