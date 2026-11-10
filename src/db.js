import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SITES, SITE_KEYS } from './defaults.js';

const dataDir = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'app.db'));

// 모든 시각은 KST(UTC+9) 문자열로 저장
const NOW = "datetime('now','+9 hours')";

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 3000;

  CREATE TABLE IF NOT EXISTS sites (
    key        TEXT PRIMARY KEY,
    theme      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'live',
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE IF NOT EXISTS visits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    site       TEXT NOT NULL,
    path       TEXT,
    ip         TEXT,
    ua         TEXT,
    referrer   TEXT,
    visitor    TEXT,
    mobile     INTEGER NOT NULL DEFAULT 0,
    bot        INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);
  CREATE INDEX IF NOT EXISTS idx_visits_site_created ON visits(site, created_at);

  -- 클릭 이벤트 (버튼·링크). 클릭률 = 클릭 수 / 조회수(PV)
  CREATE TABLE IF NOT EXISTS clicks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    site       TEXT NOT NULL,
    label      TEXT,
    href       TEXT,
    visitor    TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX IF NOT EXISTS idx_clicks_site ON clicks(site, created_at);

  CREATE TABLE IF NOT EXISTS inquiries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    site       TEXT NOT NULL,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    grade      TEXT,
    subject    TEXT,
    message    TEXT,
    status     TEXT NOT NULL DEFAULT 'new',
    memo       TEXT NOT NULL DEFAULT '',
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX IF NOT EXISTS idx_inq_created ON inquiries(created_at);
`);

// 시드
const seed = db.prepare('INSERT OR IGNORE INTO sites (key, theme, status, data) VALUES (?, ?, ?, ?)');
for (const key of SITE_KEYS) {
  const s = DEFAULT_SITES[key];
  seed.run(key, s.theme, s.status, JSON.stringify(s.data));
}

const getStmt = db.prepare('SELECT * FROM sites WHERE key = ?');
const listStmt = db.prepare('SELECT * FROM sites ORDER BY rowid');
const saveStmt = db.prepare(`UPDATE sites SET data = ?, status = ?, updated_at = ${NOW} WHERE key = ?`);

function hydrate(row) {
  if (!row) return null;
  return { key: row.key, theme: row.theme, status: row.status, updatedAt: row.updated_at, ...JSON.parse(row.data) };
}

export const getSite = (key) => hydrate(getStmt.get(key));
export const listSites = () => listStmt.all().map(hydrate);
export const saveSite = (key, data, status) => saveStmt.run(JSON.stringify(data), status, key);

export const insertVisit = db.prepare(
  'INSERT INTO visits (site, path, ip, ua, referrer, visitor, mobile, bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
export const insertClick = db.prepare(
  'INSERT INTO clicks (site, label, href, visitor, ip) VALUES (?, ?, ?, ?, ?)'
);
export const insertInquiry = db.prepare(
  'INSERT INTO inquiries (site, name, phone, grade, subject, message, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
export { NOW };
