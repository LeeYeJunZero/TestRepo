import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SITE, SITE_KEY } from './defaults.js';

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

  -- 페이지 조회 (페이지 로드 1회 = 1건)
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

  -- 과목 이벤트: view = 과목 섹션이 화면에 노출됨(페이지 로드당 과목별 1회), click = 과목 영역 안 클릭
  -- 과목 클릭률 = click ÷ view
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    subject    TEXT,
    label      TEXT,
    href       TEXT,
    visitor    TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, subject, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

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

// 키-값 설정 (텔레그램 관리자 채팅, 알림 on/off 등)
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
const getSetStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const putSetStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
export function getSetting(key, fallback) {
  const r = getSetStmt.get(key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}
export const setSetting = (key, value) => putSetStmt.run(key, JSON.stringify(value));

db.prepare('INSERT OR IGNORE INTO sites (key, theme, status, data) VALUES (?, ?, ?, ?)')
  .run(SITE_KEY, DEFAULT_SITE.theme, DEFAULT_SITE.status, JSON.stringify(DEFAULT_SITE.data));

const getStmt = db.prepare('SELECT * FROM sites WHERE key = ?');
const saveStmt = db.prepare(`UPDATE sites SET data = ?, status = ?, updated_at = ${NOW} WHERE key = ?`);

export function getSite() {
  const row = getStmt.get(SITE_KEY);
  return { key: row.key, theme: row.theme, status: row.status, updatedAt: row.updated_at, ...JSON.parse(row.data) };
}
export const saveSite = (data, status) => saveStmt.run(JSON.stringify(data), status, SITE_KEY);

export const insertVisit = db.prepare(
  'INSERT INTO visits (site, path, ip, ua, referrer, visitor, mobile, bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
export const insertEvent = db.prepare(
  'INSERT INTO events (kind, subject, label, href, visitor, ip) VALUES (?, ?, ?, ?, ?, ?)'
);
export const insertInquiry = db.prepare(
  'INSERT INTO inquiries (site, name, phone, grade, subject, message, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
