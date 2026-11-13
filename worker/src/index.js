// 퍼스트티쳐 API — Cloudflare Worker + D1 (24시간, PC 불필요)
//  POST /api/track    페이지 조회
//  POST /api/event    과목 노출(view) · 클릭(click)
//  POST /api/inquiry  상담 신청 → 텔레그램 즉시 알림
//  GET  /api/site     공지 · 운영 상태 · 상담 창 표시 (사이트가 로드 시 읽음 → /notice, /maint, /chat 즉시 반영)
//  POST /api/chat       실시간 상담: 방문자 메시지 → 텔레그램 (관리자가 알림에 답장하면 방문자에게 전달)
//  POST /api/chat/poll  실시간 상담: 새 메시지 확인 (방문자 창이 몇 초마다 호출)
//  POST /tg           텔레그램 웹훅 (X-Telegram-Bot-Api-Secret-Token 검증)
//  cron 매 1분         미전송 클릭을 묶어서 텔레그램 알림
// secrets: TELEGRAM_BOT_TOKEN, ADMIN_PASSWORD   vars: ALLOWED_ORIGINS

const SUBJECTS = ['math', 'english', 'coding'];
const SUBJECT_NAME = { math: '수학', english: '영어', coding: '코딩' };
const SUBJ_ICON = { math: '🟢', english: '🟣', coding: '🔵' };
const INQ_STATUS = ['new', 'contacted', 'enrolled', 'closed'];
const INQ_LABEL = { new: '신규', contacted: '연락완료', enrolled: '등록', closed: '종료' };
const DEFAULT_NOTIFY = { inquiry: true, click: true, visit: false };
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|curl|wget|python-requests|httpclient/i;
const MOBILE_RE = /Mobi|Android|iPhone|iPad/i;

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const isVid = (v) => /^[a-f0-9]{32}$/.test(v || '');
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const h = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ESC[c]);
const hm = (ts) => String(ts || '').slice(11, 16);
const md = (ts) => String(ts || '').slice(5, 16);
const subj = (s) => (s ? SUBJECT_NAME[s] || s : '공통');
const ctr = (c, v) => (v ? Math.round((c / v) * 1000) / 10 : 0);

export async function webhookSecret(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ft-webhook:' + token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(a))), crypto.subtle.digest('SHA-256', enc.encode(String(b)))]);
  const ax = new Uint8Array(x), ay = new Uint8Array(y);
  let d = 0; for (let i = 0; i < ax.length; i++) d |= ax[i] ^ ay[i];
  return d === 0;
}

// ───────── D1 헬퍼 ─────────
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
async function getSetting(db, key, fallback) {
  const r = await first(db, 'SELECT value FROM settings WHERE key = ?', key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}
const setSetting = (db, key, value) =>
  run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));

// ───────── 레이트 리밋 (isolate 단위 best-effort) ─────────
const buckets = new Map();
function limited(name, ip, max, windowMs) {
  const k = name + ':' + ip, now = Date.now();
  let b = buckets.get(k);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
  if (buckets.size > 5000) buckets.clear();
  return ++b.n > max;
}

// ───────── 텔레그램 ─────────
function tg(env) {
  const base = `${env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${env.TELEGRAM_BOT_TOKEN}`;
  const call = async (method, body = {}) => {
    const r = await fetch(`${base}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
    return j.result;
  };
  const send = (chatId, text, extra = {}) =>
    call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }).catch((e) => console.error(e.message));
  return { call, send };
}
async function broadcast(env, text, extra) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const admins = await getSetting(env.DB, 'tg_admins', []);
  const { send } = tg(env);
  await Promise.all(admins.map((id) => send(id, text, extra)));
}
const notifyCfg = async (db) => ({ ...DEFAULT_NOTIFY, ...(await getSetting(db, 'tg_notify', {})) });

const inqButtons = (id) => ({
  inline_keyboard: [[
    { text: '📞 연락완료', callback_data: `inq:${id}:contacted` },
    { text: '✅ 등록', callback_data: `inq:${id}:enrolled` },
    { text: '⏹ 종료', callback_data: `inq:${id}:closed` },
    { text: '🗑 삭제', callback_data: `inq:${id}:delete` }
  ]]
});
const inqText = (r) => [
  `📩 <b>상담 신청 #${r.id}</b> · ${h(INQ_LABEL[r.status])}`,
  `👤 ${h(r.name)}  📞 ${h(r.phone)}`,
  `🎓 ${h(r.grade)}${r.subject ? `  📚 ${h(r.subject)}` : ''}`,
  r.mode ? `🖥 ${h(r.mode)}` : '',
  r.school ? `🏫 ${h(r.school)}` : '',
  r.address ? `🏠 ${h(r.address)}` : '',
  r.message ? `💬 ${h(r.message)}` : '',
  r.memo ? `📝 ${h(r.memo)}` : '',
  `🕒 ${h(r.created_at)}`
].filter(Boolean).join('\n');

// ───────── 실시간 상담 (채팅) ─────────
// 방문자 메시지 → 관리자 텔레그램. 관리자가 그 알림에 '답장'하면 방문자 채팅 창에 표시 (방문자는 몇 초마다 확인)
const CHAT_MAX = 1000;
const CHAT_AUTO = '선생님께 바로 전달했어요. 답장은 이 창에 표시돼요.\n답이 늦어지면 연락처(전화번호)를 남겨 주세요. 확인하고 전화로 안내해 드릴게요.';
const CHAT_END = '상담이 종료되었습니다. 더 궁금한 점이 있으면 언제든 다시 남겨 주세요.';
const CHAT_WHO = { user: '👤', admin: '🧑‍🏫', system: '🤖' };
const isToken = (v) => /^[a-f0-9]{32}$/.test(v || '');
async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const chatOn = async (db) => (await getSetting(db, 'chat', true)) !== false;
const chatMsgs = (db, chatId, after = 0) =>
  all(db, 'SELECT id, sender, text, created_at FROM chat_messages WHERE chat_id = ? AND id > ? ORDER BY id LIMIT 100', chatId, after);
const pubMsg = (m) => ({ id: m.id, from: m.sender, text: m.text, at: m.created_at });
const chatButtons = (id) => ({
  inline_keyboard: [[{ text: '📜 대화 전체', callback_data: `chat:${id}:log` }, { text: '⏹ 상담 종료', callback_data: `chat:${id}:end` }]]
});
const chatPlace = (c) => `📄 ${h(c.title || c.page || '-')}${c.title && c.page ? `\n🔗 ${h(c.page)}` : ''}\n${c.mobile ? '📱 모바일' : '💻 PC'} · 🕒 ${h(md(c.created_at))}`;

// 텔레그램으로 보내고, 그 메시지를 채팅방에 연결 (관리자가 답장하면 방문자에게 전달)
async function chatSendTo(env, adminChat, chatId, text, extra = {}) {
  try {
    const m = await tg(env).call('sendMessage', { chat_id: adminChat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
    if (m?.message_id) await run(env.DB, 'INSERT OR IGNORE INTO chat_tg (tg_chat, tg_msg, chat_id) VALUES (?, ?, ?)', adminChat, m.message_id, chatId);
  } catch (e) { console.error('chat notify', e.message); }
}
async function chatBroadcast(env, chatId, text, extra, exceptChat) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const admins = await getSetting(env.DB, 'tg_admins', []);
  await Promise.all(admins.filter((a) => a !== exceptChat).map((a) => chatSendTo(env, a, chatId, text, extra)));
}
// 관리자 답장 → 방문자 화면
async function chatReply(env, adminChat, chatId, text, replyMsgId) {
  const db = env.DB;
  const { send, call } = tg(env);
  const body = clip(text, CHAT_MAX);
  if (!body) return send(adminChat, '보낼 내용이 없습니다.');
  const c = await first(db, 'SELECT id FROM chats WHERE id = ?', chatId);
  if (!c) return send(adminChat, `❓ 실시간 상담 #${chatId} 이(가) 없습니다.`);
  await run(db, "INSERT INTO chat_messages (chat_id, sender, text) VALUES (?, 'admin', ?)", chatId, body);
  await run(db, "UPDATE chats SET status = 'open', updated_at = datetime('now','+9 hours') WHERE id = ?", chatId);
  // 전달 확인: 내 답장에 👍 반응 (안 되면 짧은 메시지)
  const reacted = replyMsgId
    ? await call('setMessageReaction', { chat_id: adminChat, message_id: replyMsgId, reaction: [{ type: 'emoji', emoji: '👍' }] }).then(() => true, () => false)
    : false;
  if (!reacted) await send(adminChat, `✅ 실시간 상담 #${chatId} 방문자에게 전달했습니다.`);
  await chatBroadcast(env, chatId, `↪️ <b>#${chatId}</b> 다른 관리자의 답변\n${h(body)}`, {}, adminChat);
}
async function chatLogText(db, chatId) {
  const c = await first(db, 'SELECT * FROM chats WHERE id = ?', chatId);
  if (!c) return null;
  const rows = await all(db, 'SELECT sender, text, created_at FROM chat_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 30', chatId);
  const head = `📜 <b>실시간 상담 #${chatId}</b> · ${c.status === 'open' ? '진행 중' : '종료'}\n${chatPlace(c)}\n`;
  // 텔레그램 4096자 제한: 최근 메시지부터 채움
  const lines = [];
  let size = head.length;
  for (const m of rows) {
    const line = `${md(m.created_at)} ${CHAT_WHO[m.sender] || ''} ${h(m.text.length > 300 ? m.text.slice(0, 300) + '…' : m.text)}`;
    if (size + line.length > 3600) { lines.push('…'); break; }
    lines.push(line); size += line.length + 1;
  }
  return `${head}\n${lines.reverse().join('\n')}\n\n↩️ 이 메시지에 답장하면 방문자에게 전달됩니다.`;
}

// 미전송 클릭 묶음 알림 (cron 매 1분)
export async function flushClicks(env) {
  const db = env.DB;
  const rows = await all(db, "SELECT id, subject, label, created_at FROM events WHERE kind = 'click' AND notified = 0 ORDER BY id LIMIT 200");
  if (!rows.length) return 0;
  await run(db, "UPDATE events SET notified = 1 WHERE kind = 'click' AND notified = 0 AND id <= ?", rows[rows.length - 1].id);
  if (!(await notifyCfg(db)).click) return 0;
  const lines = rows.slice(-15).map((e) => `${hm(e.created_at)} ${SUBJ_ICON[e.subject] || '⚪'} ${h(subj(e.subject))} · ${h(e.label || '(이름 없음)')}`);
  await broadcast(env, `🖱️ <b>클릭 ${rows.length}건</b>${rows.length > 15 ? ' (최근 15건)' : ''}\n${lines.join('\n')}`);
  return rows.length;
}

// 보조: 요청이 들어올 때 60초 넘게 쌓인 클릭이 있으면 즉시 전송 (cron 지연 대비)
async function flushIfStale(env) {
  const r = await first(env.DB, "SELECT MIN(created_at) t FROM events WHERE kind = 'click' AND notified = 0");
  if (r?.t && r.t <= new Date(Date.now() + 9 * 3600e3 - 60_000).toISOString().replace('T', ' ').slice(0, 19)) await flushClicks(env);
}

// ───────── 통계 ─────────
async function statsText(db, daysIn) {
  const days = Math.min(Math.max(parseInt(daysIn) || 7, 1), 90);
  const since = `datetime('now','+9 hours','-${days - 1} days','start of day')`;
  const t = await first(db, `SELECT COUNT(*) pv, COUNT(DISTINCT visitor) uv, SUM(mobile) mobile,
    SUM(created_at >= datetime('now','+9 hours','start of day')) today_pv FROM visits WHERE created_at >= ${since} AND bot = 0`);
  const sub = await all(db, `SELECT subject, SUM(kind='view') views, SUM(kind='click') clicks FROM events
    WHERE created_at >= ${since} AND subject IS NOT NULL GROUP BY subject`);
  const inq = await first(db, `SELECT COUNT(*) n, (SELECT COUNT(*) FROM inquiries WHERE status='new') p FROM inquiries WHERE created_at >= ${since}`);
  const refs = await all(db, `SELECT referrer, COUNT(*) n FROM visits WHERE created_at >= ${since} AND bot = 0 AND referrer <> '' GROUP BY referrer ORDER BY n DESC LIMIT 100`);
  const refMap = {};
  for (const r of refs) {
    let host; try { host = new URL(r.referrer).hostname; } catch { host = r.referrer; }
    if (/firstteacher\.co\.kr$|github\.io$|trycloudflare\.com$|workers\.dev$/.test(host)) continue;
    refMap[host] = (refMap[host] || 0) + r.n;
  }
  const topRefs = Object.entries(refMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return [
    `📊 <b>통계 (${days === 1 ? '오늘' : `최근 ${days}일`})</b>`,
    `페이지 조회 ${t.pv || 0}회 · 방문자 ${t.uv || 0}명 · 오늘 ${t.today_pv || 0}회`,
    `모바일 ${t.pv ? Math.round(((t.mobile || 0) / t.pv) * 100) : 0}% · 상담 ${inq.n}건 (미처리 ${inq.p})`,
    '', '<b>과목별</b> (노출 / 클릭 / 클릭률)',
    ...SUBJECTS.map((s) => { const r = sub.find((x) => x.subject === s) || {}; return `${SUBJ_ICON[s]} ${subj(s)}  ${r.views || 0} / ${r.clicks || 0} / ${ctr(r.clicks || 0, r.views || 0)}%`; }),
    topRefs.length ? '\n<b>유입 경로</b>\n' + topRefs.map(([k, n]) => `· ${h(k)} ${n}`).join('\n') : ''
  ].join('\n');
}
export async function getRanking(db) {
  const agg = await all(db, `SELECT subject, SUM(kind='view') views, SUM(kind='click') clicks FROM events WHERE subject IS NOT NULL GROUP BY subject`);
  const labels = await all(db, `SELECT subject, label, COUNT(*) n FROM events WHERE kind='click' AND subject IS NOT NULL GROUP BY subject, label ORDER BY n DESC`);
  const page = await first(db, 'SELECT COUNT(*) pv, COUNT(DISTINCT visitor) uv FROM visits WHERE bot = 0');
  const rows = SUBJECTS.map((s) => {
    const a = agg.find((x) => x.subject === s) || {};
    return { subject: s, views: a.views || 0, clicks: a.clicks || 0, ctr: ctr(a.clicks || 0, a.views || 0), top: labels.filter((x) => x.subject === s).slice(0, 3) };
  }).sort((a, b) => b.views - a.views || b.ctr - a.ctr);
  const best = (k) => rows.reduce((a, b) => (b[k] > a[k] ? b : a), rows[0]);
  return { rows, page, mostViewed: rows[0].views ? rows[0].subject : null, mostClicked: best('clicks').clicks ? best('clicks').subject : null, bestCtr: best('ctr').ctr ? best('ctr').subject : null };
}
async function rankText(db) {
  const r = await getRanking(db);
  const medal = ['🥇', '🥈', '🥉'];
  return [
    '🏆 <b>누적 과목 순위</b> (노출 순)',
    ...r.rows.map((x, i) => `${medal[i]} ${subj(x.subject)} — 노출 ${x.views} · 클릭 ${x.clicks} · <b>${x.ctr}%</b>` +
      (x.top.length ? `\n     ↳ ${x.top.map((c) => `${h(c.label)} ${c.n}`).join(', ')}` : '')),
    '',
    `👑 최다 조회: ${r.mostViewed ? subj(r.mostViewed) : '–'}`,
    `🖱️ 최다 클릭: ${r.mostClicked ? subj(r.mostClicked) : '–'}`,
    `🎯 최고 클릭률: ${r.bestCtr ? subj(r.bestCtr) : '–'}`,
    `🌐 전체 페이지 조회 ${r.page.pv}회 · 방문자 ${r.page.uv}명`
  ].join('\n');
}

const COMMANDS = [
  ['stats', '기간 통계 (예: /stats 7)'], ['rank', '누적 과목 순위·클릭률'], ['visits', '최근 접속 기록'],
  ['clicks', '최근 클릭 기록'], ['inq', '미처리 상담 (/inq all 전체)'],
  ['chat', '진행 중 실시간 상담 (/chat on · off 상담 창 표시)'], ['r', '실시간 상담 답장 (/r 번호 내용)'], ['notify', '알림 설정'],
  ['notice', '상단 공지 (/notice 내용 · /notice off)'], ['maint', '점검 모드 (/maint on · off)'],
  ['purge', '30일 이전 접속·클릭 기록 삭제'], ['help', '도움말']
];
const help = () => '<b>퍼스트티쳐 관리 봇</b>\n' + COMMANDS.map(([c, d]) => `/${c} — ${h(d)}`).join('\n') + '\n/memo 번호 내용 — 상담 메모' +
  '\n\n💬 실시간 상담 알림에 <b>답장</b>하면 방문자 화면에 바로 표시됩니다.';
const notifyKeyboard = (n) => {
  const b = (k, label) => ({ text: `${n[k] ? '🔔' : '🔕'} ${label}`, callback_data: `notify:${k}` });
  return { inline_keyboard: [[b('inquiry', '상담'), b('click', '클릭'), b('visit', '접속')]] };
};

async function handleMessage(env, msg) {
  const db = env.DB;
  const { send } = tg(env);
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.replace(/^\//, '').replace(/@.*$/, '').toLowerCase();
  const arg = text.slice(cmdRaw.length).trim();
  const admins = await getSetting(db, 'tg_admins', []);

  if (cmd === 'pair') {
    if (!env.ADMIN_PASSWORD || !(await safeEqual(arg, env.ADMIN_PASSWORD))) return send(chatId, '❌ 비밀번호가 올바르지 않습니다.');
    if (!admins.includes(chatId)) await setSetting(db, 'tg_admins', [...admins, chatId]);
    return send(chatId, '✅ 관리자로 등록되었습니다. 이제 상담·클릭 알림을 받습니다.\n\n' + help());
  }
  if (!admins.includes(chatId)) return text ? send(chatId, '🔒 등록되지 않은 채팅입니다.\n<code>/pair 어드민비밀번호</code> 로 연결하세요.') : undefined;

  // 실시간 상담 알림에 '답장' → 방문자에게 전달
  const replyTo = msg.reply_to_message?.message_id;
  if (replyTo && !text.startsWith('/')) {
    const link = await first(db, 'SELECT chat_id FROM chat_tg WHERE tg_chat = ? AND tg_msg = ?', chatId, replyTo);
    if (link) return text ? chatReply(env, chatId, link.chat_id, text, msg.message_id) : send(chatId, '✏️ 실시간 상담에는 글자로만 답장할 수 있어요.');
  }
  if (!text) return;

  switch (cmd) {
    case 'start': case 'help': return send(chatId, help());
    case 'stats': return send(chatId, await statsText(db, rest[0] || 7));
    case 'rank': return send(chatId, await rankText(db));
    case 'visits': {
      const rows = await all(db, 'SELECT * FROM visits WHERE bot = 0 ORDER BY id DESC LIMIT ?', Math.min(parseInt(rest[0]) || 10, 30));
      return send(chatId, `🧭 <b>최근 접속 ${rows.length}건</b>\n` + (rows.map((v) =>
        `${md(v.created_at)} ${v.mobile ? '📱' : '💻'} ${h(v.path)}${v.referrer ? ` ↪ ${h(v.referrer.replace(/^https?:\/\//, '').slice(0, 40))}` : ''}`).join('\n') || '기록 없음'));
    }
    case 'clicks': {
      const rows = await all(db, "SELECT * FROM events WHERE kind = 'click' ORDER BY id DESC LIMIT ?", Math.min(parseInt(rest[0]) || 10, 30));
      return send(chatId, `🖱️ <b>최근 클릭 ${rows.length}건</b>\n` + (rows.map((e) =>
        `${md(e.created_at)} ${SUBJ_ICON[e.subject] || '⚪'} ${h(subj(e.subject))} · ${h(e.label)}`).join('\n') || '기록 없음'));
    }
    case 'inq': {
      const rows = rest[0] === 'all'
        ? await all(db, 'SELECT * FROM inquiries ORDER BY id DESC LIMIT 10')
        : await all(db, "SELECT * FROM inquiries WHERE status = 'new' ORDER BY id DESC LIMIT 10");
      if (!rows.length) return send(chatId, rest[0] === 'all' ? '📭 상담 신청이 없습니다.' : '📭 미처리 상담이 없습니다.');
      for (const r of rows.reverse()) await send(chatId, inqText(r), { reply_markup: inqButtons(r.id) });
      return;
    }
    case 'chat': {
      if (['on', 'off'].includes(rest[0])) {
        await setSetting(db, 'chat', rest[0] === 'on');
        return send(chatId, rest[0] === 'on' ? '💬 실시간 상담 창을 켰습니다. (사이트에 즉시 반영)' : '💬 실시간 상담 창을 숨겼습니다. (사이트에 즉시 반영)');
      }
      const rows = await all(db, `SELECT c.*,
        (SELECT text FROM chat_messages m WHERE m.chat_id = c.id AND m.sender <> 'system' ORDER BY m.id DESC LIMIT 1) last_text,
        (SELECT sender FROM chat_messages m WHERE m.chat_id = c.id AND m.sender <> 'system' ORDER BY m.id DESC LIMIT 1) last_from
        FROM chats c WHERE c.status = 'open' ORDER BY c.updated_at DESC LIMIT 5`);
      const state = `상담 창: ${(await chatOn(db)) ? '켜짐' : '꺼짐'} (/chat on · /chat off)`;
      if (!rows.length) return send(chatId, `💬 진행 중인 실시간 상담이 없습니다.\n${state}`);
      await send(chatId, `💬 <b>진행 중 실시간 상담 ${rows.length}건</b> (최근 순)\n${state}\n각 메시지에 답장하면 그 방문자에게 전달됩니다.`);
      for (const r of rows.reverse()) {
        const last = String(r.last_text || '');
        await chatSendTo(env, chatId, r.id, `💬 <b>#${r.id}</b> · ${h(md(r.updated_at))} · ${r.last_from === 'user' ? '⏳ 답변 대기' : '답변함'}\n${chatPlace(r)}\n\n${CHAT_WHO[r.last_from] || ''} ${h(last.length > 300 ? last.slice(0, 300) + '…' : last)}`, { reply_markup: chatButtons(r.id) });
      }
      return;
    }
    case 'r': {
      const id = parseInt(rest[0]);
      const body = arg.replace(/^\d+\s*/, '');
      if (!id || !body) return send(chatId, '사용법: /r 번호 내용  (또는 실시간 상담 알림에 답장)');
      return chatReply(env, chatId, id, body, msg.message_id);
    }
    case 'memo': {
      const id = parseInt(rest[0]);
      const memo = rest.slice(1).join(' ').slice(0, 1000);
      const r = id ? await run(db, 'UPDATE inquiries SET memo = ? WHERE id = ?', memo, id) : null;
      return send(chatId, r?.meta?.changes ? `📝 #${id} 메모 저장` : '사용법: /memo 번호 내용');
    }
    case 'notify': return send(chatId, '🔔 <b>알림 설정</b> (눌러서 켜기/끄기)', { reply_markup: notifyKeyboard(await notifyCfg(db)) });
    case 'notice': {
      if (!arg) return send(chatId, `📢 현재 공지: ${h(await getSetting(db, 'notice', null)) || '(사이트 기본값)'}\n변경: /notice 내용 · 숨김: /notice off · 기본값: /notice reset`);
      if (arg === 'reset') { await run(db, "DELETE FROM settings WHERE key = 'notice'"); return send(chatId, '📢 공지를 사이트 기본값으로 되돌렸습니다.'); }
      const v = arg === 'off' ? '' : arg.slice(0, 120);
      await setSetting(db, 'notice', v);
      return send(chatId, v ? `📢 공지 변경: ${h(v)}\n(사이트에 즉시 반영)` : '📢 공지 숨김');
    }
    case 'maint': {
      const cur = await getSetting(db, 'status', 'live');
      if (!['on', 'off'].includes(rest[0])) return send(chatId, `🛠 현재: ${cur === 'maintenance' ? '점검 중' : '운영 중'}\n/maint on · /maint off`);
      await setSetting(db, 'status', rest[0] === 'on' ? 'maintenance' : 'live');
      return send(chatId, rest[0] === 'on' ? '🛠 점검 모드 ON (사이트에 점검 안내, 상담 접수 중단)' : '✅ 운영 모드로 전환');
    }
    case 'purge': {
      const cut = "datetime('now','+9 hours','-30 days')";
      const r = await run(db, `DELETE FROM visits WHERE created_at < ${cut}`);
      await run(db, `DELETE FROM events WHERE created_at < ${cut}`);
      return send(chatId, `🧹 30일 이전 기록 ${r.meta?.changes || 0}건 삭제`);
    }
    default: return send(chatId, '알 수 없는 명령입니다.\n' + help());
  }
}

async function handleCallback(env, cb) {
  const db = env.DB;
  const { call } = tg(env);
  const chatId = cb.message?.chat?.id;
  const ack = (text) => call('answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {});
  const admins = await getSetting(db, 'tg_admins', []);
  if (!admins.includes(chatId)) return ack('권한 없음');
  const [kind, a, b] = String(cb.data || '').split(':');
  if (kind === 'notify' && a in DEFAULT_NOTIFY) {
    const n = await notifyCfg(db); n[a] = !n[a]; await setSetting(db, 'tg_notify', n);
    await ack(`${a} 알림 ${n[a] ? 'ON' : 'OFF'}`);
    return call('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: notifyKeyboard(n) }).catch(() => {});
  }
  if (kind === 'chat') {
    const id = parseInt(a);
    if (b === 'log') {
      const text = await chatLogText(db, id);
      if (!text) return ack('없는 상담');
      await ack();
      return chatSendTo(env, chatId, id, text, { reply_markup: chatButtons(id) });
    }
    if (b === 'end') {
      const c = await first(db, 'SELECT status FROM chats WHERE id = ?', id);
      if (!c) return ack('없는 상담');
      if (c.status !== 'closed') {
        await run(db, "UPDATE chats SET status = 'closed', updated_at = datetime('now','+9 hours') WHERE id = ?", id);
        await run(db, "INSERT INTO chat_messages (chat_id, sender, text) VALUES (?, 'system', ?)", id, CHAT_END);
      }
      await ack('상담을 종료했습니다');
      return call('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[{ text: '⏹ 종료됨 · 📜 대화 전체', callback_data: `chat:${id}:log` }]] } }).catch(() => {});
    }
    return ack();
  }
  if (kind === 'inq') {
    const id = parseInt(a);
    if (b === 'delete') {
      await run(db, 'DELETE FROM inquiries WHERE id = ?', id);
      await ack('삭제했습니다');
      return call('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `🗑 상담 신청 #${id} 삭제됨` }).catch(() => {});
    }
    if (!INQ_STATUS.includes(b)) return ack();
    await run(db, 'UPDATE inquiries SET status = ? WHERE id = ?', b, id);
    const r = await first(db, 'SELECT * FROM inquiries WHERE id = ?', id);
    if (!r) return ack('없는 항목');
    await ack(INQ_LABEL[b]);
    return call('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: inqText(r), parse_mode: 'HTML', reply_markup: inqButtons(id) }).catch(() => {});
  }
  return ack();
}

// ───────── HTTP ─────────
function corsHeaders(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }
    : null;
}
const json = (data, status = 200, headers = {}) =>
  new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const db = env.DB;
    const ip = req.headers.get('cf-connecting-ip') || '';
    const ua = clip(req.headers.get('user-agent'), 400);
    const isBot = BOT_RE.test(ua);

    // 텔레그램 웹훅
    if (url.pathname === '/tg' && req.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN) return new Response('no bot', { status: 404 });
      const secret = await webhookSecret(env.TELEGRAM_BOT_TOKEN);
      if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) return new Response('forbidden', { status: 403 });
      const u = await req.json().catch(() => ({}));
      try {
        if (u.message?.chat) await handleMessage(env, u.message);
        else if (u.callback_query) await handleCallback(env, u.callback_query);
      } catch (e) { console.error('tg handler', e); }
      return new Response('ok');
    }

    if (!url.pathname.startsWith('/api/')) return new Response('FirstTeacher API', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

    const cors = corsHeaders(req, env);
    // 몇 초마다 오는 채팅 확인(poll)은 제외: D1 읽기 절약
    if (req.method === 'POST' && cors && url.pathname !== '/api/chat/poll') ctx.waitUntil(flushIfStale(env).catch((e) => console.error('flush', e)));
    if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    if (!cors) return json({ error: 'origin not allowed' }, 403);
    const reply = (data, status) => json(data, status, cors);

    if (url.pathname === '/api/site' && req.method === 'GET') {
      const notice = await getSetting(db, 'notice', null);
      return json({ notice, status: await getSetting(db, 'status', 'live'), chat: await chatOn(db) }, 200, { ...cors, 'Cache-Control': 'no-store' });
    }
    if (req.method !== 'POST') return reply({ error: 'not found' }, 404);
    const b = await req.json().catch(() => ({}));

    if (url.pathname === '/api/track') {
      if (limited('track', ip, 120, 60_000)) return reply({ error: 'too many' }, 429);
      const origin = (req.headers.get('origin') || '').replace(/^https?:\/\//, '');
      const path = clip(origin + clip(b.path, 250), 300);
      const vid = isVid(b.vid) ? b.vid : crypto.randomUUID().replace(/-/g, '');
      const mobile = MOBILE_RE.test(ua);
      await run(db, 'INSERT INTO visits (path, ip, ua, referrer, visitor, mobile, bot) VALUES (?, ?, ?, ?, ?, ?, ?)',
        path, ip, ua, clip(b.referrer, 400), vid, mobile ? 1 : 0, isBot ? 1 : 0);
      if (!isBot) ctx.waitUntil((async () => {
        if (!(await notifyCfg(db)).visit) return;
        const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 16);
        await broadcast(env, `👀 <b>접속</b> ${now} · ${mobile ? '모바일' : 'PC'}\n${h(path)}${b.referrer ? `\n↪ ${h(clip(b.referrer, 200))}` : ''}`);
      })());
      return reply(null, 204);
    }

    if (url.pathname === '/api/event') {
      if (limited('event', ip, 300, 60_000)) return reply({ error: 'too many' }, 429);
      if (!['view', 'click'].includes(b.kind)) return reply({ error: 'bad kind' }, 400);
      const subject = SUBJECTS.includes(b.subject) ? b.subject : null;
      if (b.kind === 'view' && !subject) return reply({ error: 'bad subject' }, 400);
      if (isBot) return reply(null, 204);
      await run(db, 'INSERT INTO events (kind, subject, label, href, visitor, ip, notified) VALUES (?, ?, ?, ?, ?, ?, ?)',
        b.kind, subject, clip(b.label, 60), clip(b.href, 200), isVid(b.vid) ? b.vid : '', ip, b.kind === 'click' ? 0 : 1);
      return reply(null, 204);
    }

    if (url.pathname === '/api/inquiry') {
      if (limited('inq', ip, 5, 10 * 60_000)) return reply({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, 429);
      if (b.website) return reply({ ok: true });
      if ((await getSetting(db, 'status', 'live')) !== 'live') return reply({ error: '현재 상담 접수가 중단되었습니다.' }, 400);
      const name = clip(b.name, 40), phone = clip(b.phone, 20);
      if (!name) return reply({ error: '이름을 입력해 주세요.' }, 400);
      if (!/^[0-9+\-() ]{8,20}$/.test(phone)) return reply({ error: '연락처를 정확히 입력해 주세요.' }, 400);
      if (!b.agree) return reply({ error: '개인정보 수집·이용에 동의해 주세요.' }, 400);
      const mode = ['방문수업', '화상수업'].includes(b.mode) ? b.mode : '';
      const r = await run(db, 'INSERT INTO inquiries (name, phone, grade, subject, message, school, address, mode, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        name, phone, clip(b.grade, 20), clip(b.subject, 80), clip(b.message, 1000), clip(b.school, 60), clip(b.address, 200), mode, ip);
      const id = r.meta?.last_row_id;
      ctx.waitUntil((async () => {
        if (!(await notifyCfg(db)).inquiry) return;
        const row = await first(db, 'SELECT * FROM inquiries WHERE id = ?', id);
        if (row) await broadcast(env, inqText(row), { reply_markup: inqButtons(id) });
      })());
      return reply({ ok: true });
    }

    // 실시간 상담: 방문자 메시지 보내기. token 이 없으면 새 상담방을 만들고 token 을 돌려줌
    if (url.pathname === '/api/chat') {
      if (limited('chat', ip, 20, 60_000)) return reply({ error: '메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.' }, 429);
      if (isBot) return reply({ error: '지금은 보낼 수 없어요. 전화나 무료 학습 30분 신청으로 문의해 주세요.' }, 403);
      if ((await getSetting(db, 'status', 'live')) !== 'live') return reply({ error: '사이트 점검 중이라 지금은 상담을 받을 수 없어요.' }, 400);
      if (!(await chatOn(db))) return reply({ error: '지금은 실시간 상담을 쉬고 있어요. 무료 학습 30분 신청이나 전화로 문의해 주세요.' }, 400);
      const text = clip(b.text, CHAT_MAX);
      if (!text) return reply({ error: '내용을 입력해 주세요.' }, 400);
      let token = isToken(b.token) ? b.token : '';
      let chat = token ? await first(db, 'SELECT * FROM chats WHERE token_hash = ?', await sha256hex(token)) : null;
      const isNew = !chat, reopened = chat?.status === 'closed';
      if (isNew) {
        if (limited('chatnew', ip, 5, 3600_000)) return reply({ error: '새 상담을 너무 많이 열었어요. 잠시 후 다시 시도해 주세요.' }, 429);
        token = crypto.randomUUID().replace(/-/g, '');
        const r = await run(db, 'INSERT INTO chats (token_hash, visitor, page, title, ip, mobile) VALUES (?, ?, ?, ?, ?, ?)',
          await sha256hex(token), isVid(b.vid) ? b.vid : '', clip(b.page, 300), clip(b.title, 120), ip, MOBILE_RE.test(ua) ? 1 : 0);
        chat = await first(db, 'SELECT * FROM chats WHERE id = ?', r.meta?.last_row_id);
      }
      await run(db, "INSERT INTO chat_messages (chat_id, sender, text) VALUES (?, 'user', ?)", chat.id, text);
      await run(db, "UPDATE chats SET status = 'open', updated_at = datetime('now','+9 hours') WHERE id = ?", chat.id);
      if (isNew || reopened) await run(db, "INSERT INTO chat_messages (chat_id, sender, text) VALUES (?, 'system', ?)", chat.id, CHAT_AUTO);
      ctx.waitUntil(chatBroadcast(env, chat.id, isNew || reopened
        ? `💬 <b>실시간 상담 #${chat.id}</b> · ${isNew ? '새 대화' : '다시 문의'}\n${chatPlace(chat)}\n\n👤 ${h(text)}\n\n↩️ 이 메시지에 <b>답장</b>하면 방문자 화면에 바로 표시됩니다.`
        : `💬 <b>#${chat.id}</b> 방문자\n👤 ${h(text)}`, { reply_markup: chatButtons(chat.id) }));
      return reply({ ok: true, token, status: 'open', messages: (await chatMsgs(db, chat.id, parseInt(b.after) || 0)).map(pubMsg) });
    }

    // 실시간 상담: 새 메시지 확인 (방문자 창이 몇 초마다 호출)
    if (url.pathname === '/api/chat/poll') {
      if (limited('chatpoll', ip, 90, 60_000)) return reply({ error: 'too many' }, 429);
      const chat = isToken(b.token) ? await first(db, 'SELECT id, status FROM chats WHERE token_hash = ?', await sha256hex(b.token)) : null;
      if (!chat) return reply({ status: 'none', messages: [] });
      return reply({ status: chat.status, messages: (await chatMsgs(db, chat.id, parseInt(b.after) || 0)).map(pubMsg) });
    }

    return reply({ error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(flushClicks(env));
  }
};
