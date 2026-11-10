-- 퍼스트티쳐 API (Cloudflare D1). 모든 시각은 KST 문자열.
CREATE TABLE IF NOT EXISTS visits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site       TEXT NOT NULL DEFAULT 'firstteacher',
  path       TEXT,
  ip         TEXT,
  ua         TEXT,
  referrer   TEXT,
  visitor    TEXT,
  mobile     INTEGER NOT NULL DEFAULT 0,
  bot        INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);

-- view = 과목 섹션 노출, click = 클릭. notified = 텔레그램 클릭 알림 전송 여부
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  subject    TEXT,
  label      TEXT,
  href       TEXT,
  visitor    TEXT,
  ip         TEXT,
  notified   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, subject, created_at);
CREATE INDEX IF NOT EXISTS idx_events_pending ON events(kind, notified);

CREATE TABLE IF NOT EXISTS inquiries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site       TEXT NOT NULL DEFAULT 'firstteacher',
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  grade      TEXT,
  subject    TEXT,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  memo       TEXT NOT NULL DEFAULT '',
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);

-- tg_admins, tg_notify, notice, status
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
