// Cloudflare Worker(worker/src/index.js) 로직 검증 — D1 을 node:sqlite 어댑터로, 텔레그램 API 를 fetch 모의로 대체
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { webhookSecret, flushClicks } from '../worker/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = new DatabaseSync(':memory:');
raw.exec(fs.readFileSync(path.join(root, 'worker/schema.sql'), 'utf8'));
// D1 API 어댑터
const DB = {
  prepare(sql) {
    const st = raw.prepare(sql);
    let args = [];
    const o = {
      bind(...a) { args = a.map((x) => (x === undefined ? null : x)); return o; },
      async all() { return { results: st.all(...args) }; },
      async first() { return st.get(...args) ?? null; },
      async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
    };
    return o;
  }
};
// 텔레그램 모의
const tgCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://tg.mock/')) {
    const method = String(url).split('/').pop();
    tgCalls.push({ method, params: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: tgCalls.length } }));
  }
  return realFetch(url, init);
};
const ORIGIN = 'https://firstteacher.co.kr';
const env = { DB, TELEGRAM_BOT_TOKEN: '1:T', TELEGRAM_API_BASE: 'https://tg.mock', ADMIN_PASSWORD: 'pw-123456789', ALLOWED_ORIGINS: `${ORIGIN},https://www.firstteacher.co.kr` };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const settle = () => Promise.all(waits.splice(0));
const UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/142';
const call = async (p, { method = 'POST', body, origin = ORIGIN, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('https://api.test' + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': '1.1.1.1', ...(origin ? { origin } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  }), env, ctx);
  await settle();
  return res;
};
let upd = 1;
const tgPost = async (u) => call('/tg', { body: { update_id: upd++, ...u }, origin: null, headers: { 'x-telegram-bot-api-secret-token': await webhookSecret(env.TELEGRAM_BOT_TOKEN) } });
const msg = (chatId, text) => tgPost({ message: { message_id: 1, chat: { id: chatId }, text } });
const lastTo = (chatId) => [...tgCalls].reverse().find((c) => c.method === 'sendMessage' && c.params.chat_id === chatId)?.params.text || '';

test('W-01 CORS: 허용 origin 만, 그 외 403', async () => {
  const ok = await call('/api/track', { method: 'OPTIONS' });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await call('/api/track', { method: 'OPTIONS', origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/track', { body: { path: '/' }, origin: 'https://evil.example' })).status, 403);
});

test('W-02 접속·노출·클릭 기록, 봇 분류', async () => {
  assert.equal((await call('/api/track', { body: { path: '/', referrer: 'https://search.naver.com/', vid: 'a'.repeat(32) } })).status, 204);
  assert.equal((await call('/api/track', { body: { path: '/' }, headers: { 'user-agent': 'Googlebot' } })).status, 204);
  const v = raw.prepare('SELECT * FROM visits ORDER BY id').all();
  assert.equal(v[0].path, 'firstteacher.co.kr/');
  assert.equal(v[0].ip, '1.1.1.1');
  assert.equal(v[1].bot, 1);
  for (const s of ['english', 'english', 'math']) assert.equal((await call('/api/event', { body: { kind: 'view', subject: s } })).status, 204);
  assert.equal((await call('/api/event', { body: { kind: 'click', subject: 'english', label: '이 과정 상담하기' } })).status, 204);
  assert.equal((await call('/api/event', { body: { kind: 'view', subject: 'history' } })).status, 400);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM events WHERE kind='click' AND notified=0").get().n, 1);
});

test('W-03 텔레그램: 웹훅 secret 검증, /pair, 미등록 거부', async () => {
  const bad = await call('/tg', { body: { message: { chat: { id: 1 }, text: '/rank' } }, origin: null, headers: { 'x-telegram-bot-api-secret-token': 'wrong' } });
  assert.equal(bad.status, 403);
  await msg(999, '/rank');
  assert.match(lastTo(999), /등록되지 않은/);
  await msg(777, '/pair nope');
  assert.match(lastTo(777), /올바르지 않습니다/);
  await msg(777, '/pair pw-123456789');
  assert.match(lastTo(777), /관리자로 등록/);
});

test('W-04 상담 신청 → 즉시 알림 + 버튼 → 상태 변경', async () => {
  const r = await call('/api/inquiry', { body: { name: '박테스트', phone: '010-1111-2222', grade: '중학생', subject: '수학 · 중등 내신 완성', agree: true } });
  assert.equal(r.status, 200);
  assert.match(lastTo(777), /박테스트/);
  const note = [...tgCalls].reverse().find((c) => c.method === 'sendMessage' && /박테스트/.test(c.params.text));
  const cb = note.params.reply_markup.inline_keyboard[0][1].callback_data; // 등록
  await tgPost({ callback_query: { id: 'c1', data: cb, message: { message_id: 9, chat: { id: 777 } } } });
  assert.equal(raw.prepare('SELECT status FROM inquiries WHERE name = ?').get('박테스트').status, 'enrolled');
  assert.ok(tgCalls.some((c) => c.method === 'editMessageText' && /등록/.test(c.params.text)));
  assert.equal((await call('/api/inquiry', { body: { name: 'x', phone: '1', agree: true } })).status, 400);

  // 첫 방문 팝업 항목: 저장 + 알림, 정해진 수업 방식만 허용
  assert.equal((await call('/api/inquiry', { body: { name: '최팝업', phone: '010-3333-4444', grade: '중2', subject: '수학', mode: '방문수업', school: '테스트중', address: '서울 테스트로 1', message: '평일 저녁', agree: true } })).status, 200);
  const row = raw.prepare('SELECT school, address, mode FROM inquiries WHERE name = ?').get('최팝업');
  assert.deepEqual({ ...row }, { school: '테스트중', address: '서울 테스트로 1', mode: '방문수업' });
  const text = [...tgCalls].reverse().find((c) => c.method === 'sendMessage' && /최팝업/.test(c.params.text)).params.text;
  assert.match(text, /방문수업/); assert.match(text, /테스트중/); assert.match(text, /서울 테스트로 1/);
  await call('/api/inquiry', { body: { name: '이방식', phone: '010-3333-5555', mode: '상관없음', agree: true } });
  assert.equal(raw.prepare('SELECT mode FROM inquiries WHERE name = ?').get('이방식').mode, '');
});

test('W-05 cron: 미전송 클릭 묶음 알림 후 notified 처리', async () => {
  await call('/api/event', { body: { kind: 'click', subject: 'coding', label: '코딩 과정 보기' } });
  const n = await flushClicks(env);
  assert.equal(n, 2);
  assert.match(lastTo(777), /클릭 2건/);
  assert.match(lastTo(777), /영어 · 이 과정 상담하기/);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM events WHERE kind='click' AND notified=0").get().n, 0);
  assert.equal(await flushClicks(env), 0);
});

test('W-06 명령: /rank /stats /notice /maint → /api/site 즉시 반영, 점검 중 상담 차단', async () => {
  await msg(777, '/rank');
  assert.match(lastTo(777), /누적 과목 순위/);
  assert.match(lastTo(777), /🥇 영어 — 노출 2 · 클릭 1 · <b>50%<\/b>/);
  await msg(777, '/stats 7');
  assert.match(lastTo(777), /통계 \(최근 7일\)/);
  await msg(777, '/notice 겨울방학 특강 접수 중');
  let s = await (await call('/api/site', { method: 'GET' })).json();
  assert.equal(s.notice, '겨울방학 특강 접수 중');
  await msg(777, '/maint on');
  s = await (await call('/api/site', { method: 'GET' })).json();
  assert.equal(s.status, 'maintenance');
  assert.equal((await call('/api/inquiry', { body: { name: 'a', phone: '010-1234-5678', agree: true } })).status, 400);
  await msg(777, '/maint off');
  await msg(777, '/notice reset');
  s = await (await call('/api/site', { method: 'GET' })).json();
  assert.equal(s.notice, null);
  assert.equal(s.status, 'live');
});

test('W-07 알림 끄기: 클릭 알림 off 이면 전송 안 함', async () => {
  await tgPost({ callback_query: { id: 'c2', data: 'notify:click', message: { message_id: 3, chat: { id: 777 } } } });
  await call('/api/event', { body: { kind: 'click', subject: 'math', label: 'off-test' } });
  const before = tgCalls.length;
  await flushClicks(env);
  assert.ok(!tgCalls.slice(before).some((c) => c.method === 'sendMessage'));
});

// ───── 실시간 상담 ─────
const tgSentIdx = (re) => tgCalls.findLastIndex((c) => c.method === 'sendMessage' && re.test(c.params.text));
const tgMsgId = (idx) => idx + 1; // 모의 텔레그램은 message_id = 호출 순번
let chatToken = '';

test('W-08 실시간 상담: 첫 메시지 → 새 상담방·자동 안내·텔레그램 알림(답장 연결)', async () => {
  const r = await call('/api/chat', { body: { text: '수업료가 궁금해요', page: '/', title: '퍼스트티쳐 | 1:1 과외', vid: 'b'.repeat(32) } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.token, /^[a-f0-9]{32}$/);
  chatToken = j.token;
  assert.deepEqual(j.messages.map((m) => m.from), ['user', 'system']);
  assert.equal(j.messages[0].text, '수업료가 궁금해요');
  const row = raw.prepare('SELECT * FROM chats').get();
  assert.notEqual(row.token_hash, chatToken, '토큰은 해시로만 저장');
  const i = tgSentIdx(/실시간 상담 #1/);
  assert.ok(i >= 0);
  const n = tgCalls[i].params;
  assert.equal(n.chat_id, 777);
  assert.match(n.text, /새 대화/); assert.match(n.text, /수업료가 궁금해요/); assert.match(n.text, /답장/);
  assert.ok(n.reply_markup.inline_keyboard[0].some((x) => x.callback_data === 'chat:1:end'));
  assert.equal(raw.prepare('SELECT chat_id FROM chat_tg WHERE tg_chat = 777 AND tg_msg = ?').get(tgMsgId(i)).chat_id, 1);

  assert.equal((await call('/api/chat', { body: { text: '   ' } })).status, 400);
  assert.equal((await call('/api/chat', { body: { text: 'x' }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/chat', { body: { text: 'x' }, headers: { 'user-agent': 'Googlebot' } })).status, 403);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM chats').get().n, 1);
});

test('W-09 관리자가 알림에 답장 → 방문자 화면(poll)에 표시, 👍 반응, /r, 이어지는 메시지는 같은 방', async () => {
  const notif = tgMsgId(tgSentIdx(/실시간 상담 #1/));
  await tgPost({ message: { message_id: 50, chat: { id: 777 }, text: '안녕하세요! 수업료는 학년별로 안내드려요.', reply_to_message: { message_id: notif } } });
  assert.ok(tgCalls.some((c) => c.method === 'setMessageReaction' && c.params.message_id === 50));
  let p = await (await call('/api/chat/poll', { body: { token: chatToken, after: 0 } })).json();
  assert.equal(p.status, 'open');
  assert.deepEqual(p.messages.map((m) => m.from), ['user', 'system', 'admin']);
  assert.equal(p.messages[2].text, '안녕하세요! 수업료는 학년별로 안내드려요.');
  const last = p.messages[2].id;
  p = await (await call('/api/chat/poll', { body: { token: chatToken, after: last } })).json();
  assert.deepEqual(p.messages, []);
  assert.equal((await (await call('/api/chat/poll', { body: { token: 'c'.repeat(32) } })).json()).status, 'none');

  // 방문자가 이어서 쓰면 같은 방, 자동 안내는 다시 안 붙음
  const j = await (await call('/api/chat', { body: { token: chatToken, text: '중2 수학이요', after: last } })).json();
  assert.equal(j.token, chatToken);
  assert.deepEqual(j.messages.map((m) => m.from), ['user']);
  assert.match(lastTo(777), /#1<\/b> 방문자\n👤 중2 수학이요/);

  // 번호로 답장, 글자가 아닌 답장은 안내
  await msg(777, '/r 1 평일 저녁 수업 가능해요');
  assert.equal(raw.prepare("SELECT text FROM chat_messages WHERE sender = 'admin' ORDER BY id DESC").get().text, '평일 저녁 수업 가능해요');
  await tgPost({ message: { message_id: 51, chat: { id: 777 }, sticker: {}, reply_to_message: { message_id: notif } } });
  assert.match(lastTo(777), /글자로만/);
  // 등록 안 된 사람은 답장해도 전달 안 됨
  await tgPost({ message: { message_id: 52, chat: { id: 999 }, text: '가짜 답장', reply_to_message: { message_id: notif } } });
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM chat_messages WHERE text = '가짜 답장'").get().n, 0);

  // 관리자가 둘이면 다른 관리자에게도 답변이 보임
  await msg(778, '/pair pw-123456789');
  await tgPost({ message: { message_id: 53, chat: { id: 777 }, text: '편하실 때 연락처 남겨 주세요', reply_to_message: { message_id: notif } } });
  assert.match(lastTo(778), /다른 관리자의 답변\n편하실 때 연락처 남겨 주세요/);
});

test('W-10 상담 종료 버튼·다시 문의·대화 전체·/chat 목록·/chat off', async () => {
  await tgPost({ callback_query: { id: 'c3', data: 'chat:1:end', message: { message_id: 70, chat: { id: 777 } } } });
  let p = await (await call('/api/chat/poll', { body: { token: chatToken } })).json();
  assert.equal(p.status, 'closed');
  assert.match(p.messages.at(-1).text, /상담이 종료되었습니다/);

  // 종료 후 다시 쓰면 같은 방을 다시 열고 알림
  const j = await (await call('/api/chat', { body: { token: chatToken, text: '하나 더 여쭤봐도 될까요?' } })).json();
  assert.equal(j.status, 'open');
  assert.match(lastTo(777), /실시간 상담 #1<\/b> · 다시 문의/);
  assert.equal(raw.prepare("SELECT status FROM chats WHERE id = 1").get().status, 'open');

  await tgPost({ callback_query: { id: 'c4', data: 'chat:1:log', message: { message_id: 71, chat: { id: 777 } } } });
  const log = lastTo(777);
  assert.match(log, /📜 <b>실시간 상담 #1<\/b>/);
  assert.match(log, /수업료가 궁금해요[\s\S]*하나 더 여쭤봐도/);

  await msg(777, '/chat');
  assert.match(lastTo(777), /#1<\/b>[\s\S]*답변 대기[\s\S]*하나 더 여쭤봐도/);

  await msg(777, '/chat off');
  assert.equal((await (await call('/api/site', { method: 'GET' })).json()).chat, false);
  assert.equal((await call('/api/chat', { body: { token: chatToken, text: '꺼진 상태' } })).status, 400);
  await msg(777, '/chat on');
  assert.equal((await (await call('/api/site', { method: 'GET' })).json()).chat, true);
});
