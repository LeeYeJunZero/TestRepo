// 텔레그램 봇: 어드민 기능 + 실시간 알림 (롱폴링 — 공개 주소/웹훅 불필요)
//   .env  TELEGRAM_BOT_TOKEN=123456:ABC...   (@BotFather 에서 발급)
//   최초 연결: 봇에게  /pair <ADMIN_PASSWORD>  → 해당 채팅이 관리자로 등록
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getSite, saveSite, getSetting, setSetting } from './db.js';
import { getStats, getRanking, recentVisits, recentClicks, listInquiries, getInquiry, setInquiry, deleteInquiry, purgeOlderThan, INQ_LABEL } from './stats.js';
import { SUBJECT_NAME } from './defaults.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const h = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ESC[c]);
const hm = (ts) => String(ts || '').slice(11, 16);
const md = (ts) => String(ts || '').slice(5, 16);
const subj = (s) => (s ? SUBJECT_NAME[s] || s : '공통');
const SUBJ_ICON = { math: '🟢', english: '🟣', coding: '🔵' };

const DEFAULT_NOTIFY = { inquiry: true, click: true, visit: false };
const CLICK_BATCH_MS = Number(process.env.TELEGRAM_CLICK_BATCH_MS) || 30_000;

const COMMANDS = [
  ['stats', '기간 통계 (예: /stats 7)'],
  ['rank', '누적 과목 순위·클릭률'],
  ['visits', '최근 접속 기록'],
  ['clicks', '최근 클릭 기록'],
  ['inq', '미처리 상담 신청 (/inq all 전체)'],
  ['notify', '알림 설정'],
  ['notice', '상단 공지 변경 (/notice 내용 · /notice off)'],
  ['maint', '점검 모드 (/maint on · /maint off)'],
  ['publish', 'GitHub Pages 에 콘텐츠 반영'],
  ['purge', '30일 이전 접속·클릭 기록 삭제'],
  ['help', '도움말']
];

export function createTelegramBot({ token, password, apiBase = 'https://api.telegram.org', domain = '', repoDir = process.cwd(), log = console }) {
  const base = `${apiBase.replace(/\/$/, '')}/bot${token}`;
  let offset = 0, running = false, abort = null;
  let clickBuf = [], clickTimer = null;

  const admins = () => getSetting('tg_admins', []);
  const notify = () => ({ ...DEFAULT_NOTIFY, ...getSetting('tg_notify', {}) });

  async function call(method, body = {}, signal) {
    const res = await fetch(`${base}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(`${method}: ${j.description || res.status}`);
    return j.result;
  }
  const send = (chatId, text, extra = {}) =>
    call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
      .catch((e) => log.error('[telegram]', e.message));
  const broadcast = (text, extra) => Promise.all(admins().map((id) => send(id, text, extra)));

  // ───────── 알림 ─────────
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
    r.message ? `💬 ${h(r.message)}` : '',
    r.memo ? `📝 ${h(r.memo)}` : '',
    `🕒 ${h(r.created_at)}`
  ].filter(Boolean).join('\n');

  function onInquiry(row) {
    if (!notify().inquiry || !admins().length) return;
    broadcast(inqText(row), { reply_markup: inqButtons(row.id) });
  }

  function onClick(ev) {
    if (!notify().click || !admins().length) return;
    clickBuf.push(ev);
    if (!clickTimer) clickTimer = setTimeout(flushClicks, CLICK_BATCH_MS);
  }
  function flushClicks() {
    clearTimeout(clickTimer); clickTimer = null;
    if (!clickBuf.length) return;
    const list = clickBuf.splice(0);
    const lines = list.slice(-15).map((e) => `${hm(e.at)} ${SUBJ_ICON[e.subject] || '⚪'} ${h(subj(e.subject))} · ${h(e.label || '(이름 없음)')}`);
    broadcast(`🖱️ <b>클릭 ${list.length}건</b>${list.length > 15 ? ' (최근 15건)' : ''}\n${lines.join('\n')}`);
  }

  function onVisit(v) {
    if (!notify().visit || !admins().length) return;
    broadcast(`👀 <b>접속</b> ${hm(v.at)} · ${v.mobile ? '모바일' : 'PC'}\n${h(v.path)}${v.referrer ? `\n↪ ${h(v.referrer)}` : ''}`);
  }

  // ───────── 명령 ─────────
  const statsText = (days) => {
    const s = getStats(days, { domain });
    const t = s.totals;
    return [
      `📊 <b>통계 (${s.days === 1 ? '오늘' : `최근 ${s.days}일`})</b>`,
      `페이지 조회 ${t.pv || 0}회 · 방문자 ${t.uv || 0}명 · 오늘 ${t.today_pv || 0}회`,
      `모바일 ${t.pv ? Math.round(((t.mobile || 0) / t.pv) * 100) : 0}% · 상담 ${s.inqTotal}건 (미처리 ${s.pendingAll})`,
      '',
      '<b>과목별</b> (노출 / 클릭 / 클릭률)',
      ...s.subjects.map((x) => `${SUBJ_ICON[x.subject]} ${subj(x.subject)}  ${x.views} / ${x.clicks} / ${x.ctr}%`),
      s.topReferrers.length ? '\n<b>유입 경로</b>\n' + s.topReferrers.slice(0, 5).map((r) => `· ${h(r.host)} ${r.n}`).join('\n') : ''
    ].join('\n');
  };
  const rankText = () => {
    const r = getRanking();
    const medal = ['🥇', '🥈', '🥉'];
    return [
      '🏆 <b>누적 과목 순위</b> (노출 순)',
      ...r.rows.map((x, i) => `${medal[i]} ${subj(x.subject)} — 노출 ${x.views} · 클릭 ${x.clicks} · <b>${x.ctr}%</b>` +
        (x.topClicks.length ? `\n     ↳ ${x.topClicks.slice(0, 3).map((c) => `${h(c.label)} ${c.n}`).join(', ')}` : '')),
      '',
      `👑 최다 조회: ${r.mostViewed ? subj(r.mostViewed) : '–'}`,
      `🖱️ 최다 클릭: ${r.mostClicked ? subj(r.mostClicked) : '–'}`,
      `🎯 최고 클릭률: ${r.bestCtr ? subj(r.bestCtr) : '–'}`,
      `🌐 전체 페이지 조회 ${r.page.pv}회 · 방문자 ${r.page.uv}명`
    ].join('\n');
  };
  const notifyKeyboard = () => {
    const n = notify();
    const b = (k, label) => ({ text: `${n[k] ? '🔔' : '🔕'} ${label}`, callback_data: `notify:${k}` });
    return { inline_keyboard: [[b('inquiry', '상담'), b('click', '클릭'), b('visit', '접속')]] };
  };
  const help = () => '<b>퍼스트티쳐 관리 봇</b>\n' + COMMANDS.map(([c, d]) => `/${c} — ${h(d)}`).join('\n');

  // DB 콘텐츠 → site-content.json 커밋·push → GitHub Actions 가 Pages 재빌드
  function publish(chatId) {
    send(chatId, '⏳ GitHub Pages 반영 중…');
    const run = (cmd, args) => new Promise((resolve, reject) =>
      execFile(cmd, args, { cwd: repoDir, timeout: 120_000 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim().slice(0, 300))) : resolve(stdout))));
    (async () => {
      const { key, updatedAt, ...content } = getSite();
      fs.writeFileSync(path.join(repoDir, 'site-content.json'), JSON.stringify(content, null, 2) + '\n');
      const changed = (await run('git', ['status', '--porcelain', '--', 'site-content.json'])).trim();
      if (!changed) return send(chatId, '✅ 변경된 콘텐츠가 없습니다 (이미 반영됨).');
      await run('git', ['add', 'site-content.json']);
      await run('git', ['commit', '-m', '사이트 콘텐츠 반영 (텔레그램 /publish)', '--', 'site-content.json']);
      await run('git', ['push', 'origin', 'HEAD']);
      send(chatId, '✅ push 완료 — 1~2분 후 GitHub Pages 에 반영됩니다.');
    })().catch((e) => send(chatId, `❌ 실패: ${h(e.message)}`));
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.replace(/^\//, '').replace(/@.*$/, '').toLowerCase();
    const arg = text.slice(cmdRaw.length).trim();

    if (cmd === 'pair') {
      if (!password || arg !== password) return send(chatId, '❌ 비밀번호가 올바르지 않습니다.');
      const list = admins();
      if (!list.includes(chatId)) setSetting('tg_admins', [...list, chatId]);
      return send(chatId, '✅ 관리자로 등록되었습니다. 이제 상담·클릭 알림을 받습니다.\n\n' + help());
    }
    if (!admins().includes(chatId)) {
      return send(chatId, `🔒 등록되지 않은 채팅입니다.\n<code>/pair 어드민비밀번호</code> 로 연결하세요.`);
    }

    switch (cmd) {
      case 'start': case 'help': return send(chatId, help());
      case 'stats': return send(chatId, statsText(rest[0] || 7));
      case 'rank': return send(chatId, rankText());
      case 'visits': {
        const n = Math.min(parseInt(rest[0]) || 10, 30);
        const rows = recentVisits(n);
        return send(chatId, `🧭 <b>최근 접속 ${rows.length}건</b>\n` + (rows.map((v) =>
          `${md(v.created_at)} ${v.mobile ? '📱' : '💻'} ${h(v.path)}${v.referrer ? ` ↪ ${h(v.referrer.replace(/^https?:\/\//, '').slice(0, 40))}` : ''}`).join('\n') || '기록 없음'));
      }
      case 'clicks': {
        const n = Math.min(parseInt(rest[0]) || 10, 30);
        const rows = recentClicks(n);
        return send(chatId, `🖱️ <b>최근 클릭 ${rows.length}건</b>\n` + (rows.map((e) =>
          `${md(e.created_at)} ${SUBJ_ICON[e.subject] || '⚪'} ${h(subj(e.subject))} · ${h(e.label)}`).join('\n') || '기록 없음'));
      }
      case 'inq': {
        const rows = listInquiries(rest[0] === 'all' ? '' : 'new', 10);
        if (!rows.length) return send(chatId, '📭 ' + (rest[0] === 'all' ? '상담 신청이 없습니다.' : '미처리 상담이 없습니다.'));
        for (const r of rows.reverse()) await send(chatId, inqText(r), { reply_markup: inqButtons(r.id) });
        return;
      }
      case 'memo': {
        const id = parseInt(rest[0]);
        const memo = text.split(/\s+/).slice(2).join(' ');
        const r = id && setInquiry(id, { memo: memo.slice(0, 1000) });
        return send(chatId, r ? `📝 #${id} 메모 저장` : '사용법: /memo 번호 내용');
      }
      case 'notify': return send(chatId, '🔔 <b>알림 설정</b> (눌러서 켜기/끄기)', { reply_markup: notifyKeyboard() });
      case 'notice': {
        const site = getSite();
        const { key, theme, status, updatedAt, ...data } = site;
        if (!arg) return send(chatId, `📢 현재 공지: ${h(site.notice) || '(없음)'}\n변경: /notice 내용 · 삭제: /notice off`);
        data.notice = arg === 'off' ? '' : arg.slice(0, 120);
        saveSite(data, status);
        return send(chatId, `📢 공지 ${data.notice ? `변경: ${h(data.notice)}` : '삭제'}\n(서버 페이지 즉시 반영 · GitHub Pages 는 /publish 필요)`);
      }
      case 'maint': {
        const site = getSite();
        const { key, theme, status, updatedAt, ...data } = site;
        if (!['on', 'off'].includes(rest[0])) return send(chatId, `🛠 현재: ${status === 'maintenance' ? '점검 중' : '운영 중'}\n/maint on · /maint off`);
        saveSite(data, rest[0] === 'on' ? 'maintenance' : 'live');
        return send(chatId, rest[0] === 'on' ? '🛠 점검 모드 ON (상담 접수 중단)' : '✅ 운영 모드로 전환');
      }
      case 'publish': return publish(chatId);
      case 'purge': return send(chatId, `🧹 30일 이전 기록 ${purgeOlderThan(30)}건 삭제`);
      default: return send(chatId, '알 수 없는 명령입니다.\n' + help());
    }
  }

  async function handleCallback(cb) {
    const chatId = cb.message?.chat?.id;
    const ack = (text) => call('answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {});
    if (!admins().includes(chatId)) return ack('권한 없음');
    const [kind, a, b] = String(cb.data || '').split(':');
    if (kind === 'notify' && a in DEFAULT_NOTIFY) {
      const n = notify(); n[a] = !n[a]; setSetting('tg_notify', n);
      await ack(`${a} 알림 ${n[a] ? 'ON' : 'OFF'}`);
      return call('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: notifyKeyboard() }).catch(() => {});
    }
    if (kind === 'inq') {
      const id = parseInt(a);
      if (b === 'delete') {
        deleteInquiry(id);
        await ack('삭제했습니다');
        return call('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `🗑 상담 신청 #${id} 삭제됨` }).catch(() => {});
      }
      const r = setInquiry(id, { status: b });
      if (!r) return ack('없는 항목');
      await ack(INQ_LABEL[b]);
      return call('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: inqText(r), parse_mode: 'HTML', reply_markup: inqButtons(id) }).catch(() => {});
    }
    return ack();
  }

  async function loop() {
    while (running) {
      abort = new AbortController();
      try {
        const updates = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, abort.signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            if (u.message?.text) await handleMessage(u.message);
            else if (u.callback_query) await handleCallback(u.callback_query);
          } catch (e) { log.error('[telegram] handler', e); }
        }
      } catch (e) {
        if (!running) break;
        log.error('[telegram] poll', e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  return {
    async start() {
      running = true;
      try {
        const me = await call('getMe');
        // 웹훅(Cloudflare Worker)이 설정돼 있으면 롱폴링과 충돌하므로 로컬 봇은 쉼
        const wh = await call('getWebhookInfo').catch(() => ({}));
        if (wh.url) { log.log(`[telegram] @${me.username} 은 웹훅(${wh.url})으로 운영 중 → 로컬 봇 비활성`); running = false; return; }
        await call('setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description })) }).catch(() => {});
        log.log(`[telegram] @${me.username} 연결됨 · 관리자 ${admins().length}명${admins().length ? '' : ' (봇에게 /pair 비밀번호 를 보내 연결하세요)'}`);
      } catch (e) { log.error('[telegram] 토큰 확인 실패:', e.message); running = false; return; }
      loop();
    },
    stop() { running = false; abort?.abort(); flushClicks(); },
    onInquiry, onClick, onVisit, flushClicks
  };
}
