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
  school     TEXT,
  address    TEXT,
  mode       TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  memo       TEXT NOT NULL DEFAULT '',
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);

-- tg_admins, tg_notify, notice, status
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- 실시간 상담: 방문자 채팅방. token_hash = 방문자 브라우저가 가진 토큰의 SHA-256
CREATE TABLE IF NOT EXISTS chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  visitor    TEXT,
  page       TEXT,
  title      TEXT,
  ip         TEXT,
  mobile     INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(status, updated_at);

-- sender: user(방문자) · admin(선생님, 텔레그램 답장) · system(자동 안내)
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL,
  sender     TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages ON chat_messages(chat_id, id);

-- 텔레그램 알림 메시지 ↔ 채팅방 (관리자가 그 메시지에 '답장'하면 방문자에게 전달)
CREATE TABLE IF NOT EXISTS chat_tg (
  tg_chat INTEGER NOT NULL,
  tg_msg  INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  PRIMARY KEY (tg_chat, tg_msg)
);
