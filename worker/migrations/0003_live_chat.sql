-- 실시간 상담(채팅) 테이블. 운영 DB에 Worker 배포 전 1회 실행:
--   npx wrangler d1 execute firstteacher --remote --file=migrations/0003_live_chat.sql
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
